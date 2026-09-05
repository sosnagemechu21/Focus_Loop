import json
import random
from datetime import timedelta
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.db.models import Avg, Sum, Count

from .models import FocusState, SessionHistory, BoundaryEvent, CuratedVideo, ProtectedApp


def index_view(request):
    """Main dashboard & phone simulator"""
    state = FocusState.get_current()
    return render(request, 'index.html', {'state': state})


def blocked_view(request):
    """Rendered when a blocked app or YouTube in focus mode is intercepted"""
    app = request.GET.get('app', 'YouTube')
    reason = request.GET.get('reason', 'focus_locked')
    return render(request, 'blocked.html', {'app': app, 'reason': reason})


def api_status(request):
    """Current state of focus/break, timers, and today's summary"""
    state = FocusState.get_current()
    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Calculate today's stats
    today_focus_mins = SessionHistory.objects.filter(
        session_type='FOCUS',
        start_time__gte=today_start
    ).aggregate(total=Sum('actual_duration_minutes'))['total'] or 0

    today_break_mins = SessionHistory.objects.filter(
        session_type='BREAK',
        start_time__gte=today_start
    ).aggregate(total=Sum('actual_duration_minutes'))['total'] or 0

    today_shorts_blocked = BoundaryEvent.objects.filter(
        event_type='SHORTS_BLOCKED_BREAK',
        timestamp__gte=today_start
    ).count()

    today_youtube_attempts = BoundaryEvent.objects.filter(
        event_type='YOUTUBE_ATTEMPT_FOCUS',
        timestamp__gte=today_start
    ).count()

    # If in active session, compute live elapsed
    live_elapsed = state.elapsed_seconds
    live_remaining = state.remaining_seconds
    is_overrun = False

    if state.mode == 'BREAK' and state.is_expired:
        is_overrun = True

    return JsonResponse({
        'mode': state.mode,
        'session_id': state.session_id,
        'task_name': state.task_name,
        'planned_duration_minutes': state.planned_duration_minutes,
        'elapsed_seconds': live_elapsed,
        'remaining_seconds': live_remaining,
        'is_expired': state.is_expired,
        'is_overrun': is_overrun,
        'start_time': state.start_time.isoformat() if state.start_time else None,
        'next_break_time': state.next_break_time.strftime('%I:%M %p') if state.next_break_time else "12:30 PM",
        'active_video_id': state.active_video_id,
        'active_video_title': state.active_video_title,
        'is_connected': request.session.get('is_connected', False),
        'connected_email': request.session.get('connected_email', ''),
        'break_duration_minutes': request.session.get('break_minutes', 15),
        'today': {
            'focus_minutes': int(today_focus_mins),
            'break_minutes': int(today_break_mins),
            'shorts_blocked': today_shorts_blocked,
            'youtube_attempts': today_youtube_attempts,
        }
    })


@csrf_exempt
def api_connect(request):
    """Connect or disconnect YouTube / Google account"""
    data = json.loads(request.body) if request.body else {}
    email = data.get('email', '').strip()
    connected = data.get('connected', True)
    if connected and not email:
        email = 'student@gmail.com'
    request.session['is_connected'] = connected
    request.session['connected_email'] = email if connected else ''
    return JsonResponse({'status': 'ok', 'connected': connected, 'email': email})


@csrf_exempt
def api_validate_video(request):
    """Validate submitted break video URL and intercept Shorts"""
    import re
    data = json.loads(request.body) if request.body else {}
    url = data.get('url', '').strip()
    if not url:
        return JsonResponse({'status': 'error', 'message': 'No URL provided'})

    if 'shorts' in url.lower():
        BoundaryEvent.objects.create(
            event_type='SHORTS_BLOCKED_BREAK',
            app_name='YouTube Shorts',
            target_url=url,
            note='Blocked direct Shorts link submitted during break.'
        )
        return JsonResponse({
            'status': 'blocked',
            'is_short': True,
            'message': 'Shorts are quarantined! Only intentional long-form videos are allowed.'
        })

    match = re.search(r'(?:v=|\/|youtu\.be\/)([0-9A-Za-z_-]{11})', url)
    if match:
        video_id = match.group(1)
        return JsonResponse({
            'status': 'ok',
            'is_short': False,
            'video_id': video_id,
            'title': 'Custom Break Video'
        })
    return JsonResponse({
        'status': 'invalid',
        'message': 'Please enter a valid YouTube video URL (e.g. https://www.youtube.com/watch?v=...)'
    })


@csrf_exempt
def api_focus_start(request):
    """Start a new focus session"""
    data = json.loads(request.body) if request.body else {}
    duration = int(data.get('duration_minutes', 50))
    break_duration = int(data.get('break_minutes', 15))
    task = data.get('task_name', 'Study / Deep Work')
    request.session['break_minutes'] = break_duration

    state = FocusState.get_current()

    # Close previous session if was running
    if state.mode == 'BREAK':
        _close_break_session(state)

    state.mode = 'FOCUS'
    state.task_name = task
    state.start_time = timezone.now()
    state.planned_duration_minutes = duration
    state.next_break_time = timezone.now() + timedelta(minutes=duration)
    state.active_video_id = None
    state.active_video_title = None
    state.save()

    return JsonResponse({'status': 'ok', 'mode': state.mode, 'message': 'Focus mode active. YouTube is locked.'})


@csrf_exempt
def api_focus_end(request):
    """Complete current focus session"""
    state = FocusState.get_current()
    if state.mode == 'FOCUS':
        elapsed_mins = max(1.0, round(state.elapsed_seconds / 60.0, 1))
        SessionHistory.objects.create(
            session_type='FOCUS',
            task_name=state.task_name,
            start_time=state.start_time,
            end_time=timezone.now(),
            planned_duration_minutes=state.planned_duration_minutes,
            actual_duration_minutes=elapsed_mins,
            completed=True,
            overrun=False
        )
    state.mode = 'IDLE'
    state.save()
    return JsonResponse({'status': 'ok', 'mode': state.mode})


@csrf_exempt
def api_break_start(request):
    """Start an intentional break session"""
    data = json.loads(request.body) if request.body else {}
    duration = int(data.get('duration_minutes', 20))
    video_id = data.get('video_id', '')
    video_title = data.get('video_title', '')

    state = FocusState.get_current()

    # Record any active focus session completion
    if state.mode == 'FOCUS':
        elapsed_mins = max(1.0, round(state.elapsed_seconds / 60.0, 1))
        SessionHistory.objects.create(
            session_type='FOCUS',
            task_name=state.task_name,
            start_time=state.start_time,
            end_time=timezone.now(),
            planned_duration_minutes=state.planned_duration_minutes,
            actual_duration_minutes=elapsed_mins,
            completed=True
        )

    state.mode = 'BREAK'
    state.task_name = "Intentional Break 🌿"
    state.start_time = timezone.now()
    state.planned_duration_minutes = duration
    state.active_video_id = video_id
    state.active_video_title = video_title
    state.next_break_time = None
    state.save()

    BoundaryEvent.objects.create(
        event_type='BREAK_COMPLETED',
        note=f'Break started for {duration} min. Long-form unlocked, Shorts locked.',
        metadata={'duration': duration, 'video_id': video_id}
    )

    return JsonResponse({
        'status': 'ok',
        'mode': state.mode,
        'planned_minutes': duration,
        'message': f'Break mode started ({duration}m). YouTube long-form unlocked. Shorts are blocked!'
    })


def _close_break_session(state):
    elapsed_mins = round(state.elapsed_seconds / 60.0, 1)
    planned = state.planned_duration_minutes
    is_overrun = elapsed_mins > planned
    overrun_mins = max(0.0, round(elapsed_mins - planned, 1))

    SessionHistory.objects.create(
        session_type='BREAK',
        task_name='Intentional Break',
        start_time=state.start_time,
        end_time=timezone.now(),
        planned_duration_minutes=planned,
        actual_duration_minutes=elapsed_mins,
        completed=True,
        overrun=is_overrun,
        overrun_minutes=overrun_mins
    )

    if is_overrun:
        BoundaryEvent.objects.create(
            event_type='BREAK_OVERRUN',
            note=f'Break overrun by {overrun_mins} mins',
            metadata={'overrun_minutes': overrun_mins}
        )


@csrf_exempt
def api_break_end(request):
    """End break mode -> immediately locks YouTube and returns to Focus"""
    state = FocusState.get_current()
    actual_mins = 0
    overrun = False

    if state.mode == 'BREAK':
        actual_mins = round(state.elapsed_seconds / 60.0, 1)
        _close_break_session(state)

    state.mode = 'FOCUS'
    state.task_name = 'Study / Deep Work'
    state.start_time = timezone.now()
    state.planned_duration_minutes = 50
    state.next_break_time = timezone.now() + timedelta(minutes=50)
    state.active_video_id = None
    state.active_video_title = None
    state.save()

    return JsonResponse({
        'status': 'ok',
        'mode': state.mode,
        'actual_minutes': actual_mins,
        'message': 'Break complete! YouTube is locked until your next break. Back to focus.'
    })


@csrf_exempt
def api_log_event(request):
    """Record boundary friction events (e.g. YouTube attempted during focus, Shorts blocked)"""
    data = json.loads(request.body) if request.body else {}
    event_type = data.get('event_type', 'YOUTUBE_ATTEMPT_FOCUS')
    app_name = data.get('app_name', 'YouTube')
    target_url = data.get('target_url', '')
    note = data.get('note', '')

    event = BoundaryEvent.objects.create(
        event_type=event_type,
        app_name=app_name,
        target_url=target_url,
        note=note,
        metadata=data.get('metadata', {})
    )

    # If long video watched, also update watch count
    if event_type == 'LONG_VIDEO_WATCHED' and data.get('video_id'):
        CuratedVideo.objects.filter(youtube_id=data.get('video_id')).update(watch_count=models.F('watch_count') + 1)

    return JsonResponse({'status': 'ok', 'event_id': event.id, 'event_type': event.event_type})


def api_analytics(request):
    """Calculates all boundary, friction, temptation, and weekly trend metrics"""
    # 1. Break Metrics
    break_sessions = SessionHistory.objects.filter(session_type='BREAK')
    breaks_started = break_sessions.count()
    breaks_completed = break_sessions.filter(completed=True).count()
    break_overruns = break_sessions.filter(overrun=True).count()

    avg_actual = break_sessions.aggregate(avg=Avg('actual_duration_minutes'))['avg'] or 18.0
    avg_planned = break_sessions.aggregate(avg=Avg('planned_duration_minutes'))['avg'] or 20.0

    # 2. Boundary Event Metrics
    shorts_blocked = BoundaryEvent.objects.filter(event_type='SHORTS_BLOCKED_BREAK').count()
    youtube_attempts_focus = BoundaryEvent.objects.filter(event_type='YOUTUBE_ATTEMPT_FOCUS').count()
    long_videos_watched = BoundaryEvent.objects.filter(event_type='LONG_VIDEO_WATCHED').count()
    focus_completed = SessionHistory.objects.filter(session_type='FOCUS', completed=True).count()

    # On-time break percentage
    on_time_pct = int(round(((breaks_completed - break_overruns) / max(1, breaks_completed)) * 100))
    on_time_pct = min(100, max(0, on_time_pct))

    # Weekly trend: simulated or aggregated
    weekly_trend = [
        {'week': 'Week 1', 'blocked_attempts': 43, 'shorts_blocked': 65, 'avg_actual': 26},
        {'week': 'Week 2', 'blocked_attempts': 31, 'shorts_blocked': 48, 'avg_actual': 22},
        {'week': 'Week 3', 'blocked_attempts': 18, 'shorts_blocked': 29, 'avg_actual': 19},
        {'week': 'Week 4 (Current)', 'blocked_attempts': max(youtube_attempts_focus, 11), 'shorts_blocked': max(shorts_blocked, 14), 'avg_actual': round(avg_actual)},
    ]

    # Narrative feedback based on real data
    narrative = {
        'headline': 'Your breaks are getting healthier.',
        'detail': f'You planned {int(avg_planned)}-minute breaks this week and averaged {round(avg_actual, 1)} minutes.',
        'temptation_insight': f'You also attempted to open YouTube {youtube_attempts_focus} times during focus sessions. We blocked them.',
        'takeaway': "You're measuring temptation, not merely usage. Your dependency on autopilot scrolling is dropping."
    }

    # Recent boundary log (last 15 items)
    recent_events = []
    for ev in BoundaryEvent.objects.order_by('-timestamp')[:15]:
        recent_events.append({
            'id': ev.id,
            'type': ev.event_type,
            'display': ev.get_event_type_display(),
            'app': ev.app_name,
            'time': ev.timestamp.strftime('%I:%M %p'),
            'date': ev.timestamp.strftime('%b %d'),
            'note': ev.note or ev.target_url or 'Boundary protected'
        })

    return JsonResponse({
        'metrics_table': {
            'breaks_started': breaks_started,
            'breaks_completed': breaks_completed,
            'shorts_blocked': shorts_blocked,
            'long_videos_watched': long_videos_watched,
            'avg_break': f"{round(avg_actual, 1)}m",
            'avg_planned_break': f"{int(avg_planned)}m",
            'break_overruns': break_overruns,
            'youtube_attempts_during_focus': youtube_attempts_focus,
            'focus_sessions_completed': focus_completed,
        },
        'friction_report': {
            'youtube_attempts_during_focus': youtube_attempts_focus,
            'shorts_attempts_during_breaks': shorts_blocked,
            'breaks_completed_on_time_pct': on_time_pct,
            'avg_planned_min': int(avg_planned),
            'avg_actual_min': round(avg_actual, 1),
        },
        'weekly_trend': weekly_trend,
        'narrative': narrative,
        'recent_events': recent_events
    })


def api_videos(request):
    """Curated long-form videos with categories, saved filtering, and surprise me"""
    category = request.GET.get('category')
    only_saved = request.GET.get('saved') == 'true'
    surprise = request.GET.get('surprise') == 'true'

    videos = CuratedVideo.objects.all()
    if category and category != 'All':
        videos = videos.filter(category=category)
    if only_saved:
        videos = videos.filter(is_saved=True)

    if surprise and videos.exists():
        video = random.choice(list(videos))
        return JsonResponse({'video': {
            'id': video.id,
            'title': video.title,
            'channel': video.channel,
            'duration': video.duration_str,
            'duration_minutes': video.duration_minutes,
            'youtube_id': video.youtube_id,
            'category': video.category,
            'description': video.description,
            'thumbnail_url': video.thumbnail_url,
            'is_saved': video.is_saved
        }})

    data = []
    for v in videos:
        data.append({
            'id': v.id,
            'title': v.title,
            'channel': v.channel,
            'duration': v.duration_str,
            'duration_minutes': v.duration_minutes,
            'youtube_id': v.youtube_id,
            'category': v.category,
            'description': v.description,
            'thumbnail_url': v.thumbnail_url,
            'is_saved': v.is_saved
        })

    return JsonResponse({'videos': data})


@csrf_exempt
def api_toggle_saved_video(request, video_id):
    """Toggle saved status of a video"""
    try:
        video = CuratedVideo.objects.get(id=video_id)
        video.is_saved = not video.is_saved
        video.save()
        return JsonResponse({'status': 'ok', 'is_saved': video.is_saved})
    except CuratedVideo.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Video not found'}, status=404)


@csrf_exempt
def api_settings(request):
    """Get and update protected apps rules"""
    if request.method == 'POST':
        data = json.loads(request.body)
        for item in data.get('apps', []):
            ProtectedApp.objects.filter(name=item['name']).update(is_enabled=item.get('is_enabled', True))
        return JsonResponse({'status': 'ok', 'message': 'Settings updated'})

    apps = ProtectedApp.objects.all()
    if not apps.exists():
        # Default apps
        default_apps = [
            {'name': 'YouTube', 'is_enabled': True, 'special_rule': 'During allowed breaks: Long-form only.', 'icon': 'youtube'},
            {'name': 'TikTok', 'is_enabled': True, 'special_rule': 'Always blocked during focus sessions.', 'icon': 'tiktok'},
            {'name': 'Instagram', 'is_enabled': True, 'special_rule': 'Always blocked during focus sessions.', 'icon': 'instagram'},
            {'name': 'Telegram', 'is_enabled': False, 'special_rule': 'Allowed for direct messaging.', 'icon': 'telegram'},
            {'name': 'Chrome', 'is_enabled': False, 'special_rule': 'Unrestricted work browsing.', 'icon': 'chrome'},
        ]
        for item in default_apps:
            ProtectedApp.objects.create(**item)
        apps = ProtectedApp.objects.all()

    data = [{
        'id': a.id,
        'name': a.name,
        'is_enabled': a.is_enabled,
        'special_rule': a.special_rule,
        'icon': a.icon
    } for a in apps]

    return JsonResponse({'apps': data})


@csrf_exempt
def api_seed_data(request):
    """Seed initial realistic long-form videos & historical boundary interaction data"""
    _seed_curated_videos()
    _seed_mock_history()
    return JsonResponse({'status': 'ok', 'message': 'Database seeded with curated long-form library and realistic boundary metrics.'})


def _seed_curated_videos():
    if CuratedVideo.objects.count() >= 6:
        return

    curated = [
        {
            'title': 'How James Webb Space Telescope Unfolds The Universe',
            'channel': 'Veritasium',
            'duration_str': '31m',
            'duration_minutes': 31,
            'youtube_id': '4P8fKd0IVWE',
            'category': 'Science & Tech',
            'description': 'A deep dive into the engineering miracles that allowed JWST to operate 1.5 million kilometers from Earth.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&auto=format&fit=crop&q=80',
            'is_saved': True
        },
        {
            'title': 'The Secret Architecture of Kyoto Woodworkers',
            'channel': 'Craftsmanship Documentaries',
            'duration_str': '24m',
            'duration_minutes': 24,
            'youtube_id': 'rP3kK7e-v3E',
            'category': 'Craftsmanship',
            'description': 'Centuries-old joinery techniques built without a single nail, surviving earthquakes and time.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=600&auto=format&fit=crop&q=80',
            'is_saved': True
        },
        {
            'title': 'Why Cities Need Trees: The Urban Canopy Revolution',
            'channel': 'Vox Earworm & Climate',
            'duration_str': '19m',
            'duration_minutes': 19,
            'youtube_id': 'b1XGPv5x0Oo',
            'category': 'Documentary',
            'description': 'How tree cover drastically reduces ambient temperatures, improves mental cognition, and heals urban environments.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'The Art of Deep Focus: Cal Newport in Conversation',
            'channel': 'Wisdom Project',
            'duration_str': '45m',
            'duration_minutes': 45,
            'youtube_id': '3E7hkPZ-HTk',
            'category': 'Philosophy',
            'description': 'Why modern knowledge workers suffer cognitive fragmentation and the exact systems to reclaim sustained attention.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&auto=format&fit=crop&q=80',
            'is_saved': True
        },
        {
            'title': 'How Caravaggio Mastered Light and Shadow',
            'channel': 'Great Art Explained',
            'duration_str': '22m',
            'duration_minutes': 22,
            'youtube_id': 'y7r2G73g2a8',
            'category': 'Essays',
            'description': 'A visual breakdown of chiaroscuro and how one rebellious painter changed visual storytelling forever.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'The Impossible Geometry of M.C. Escher',
            'channel': 'Numberphile Stories',
            'duration_str': '28m',
            'duration_minutes': 28,
            'youtube_id': '3t78j6x0w3A',
            'category': 'Science & Tech',
            'description': 'Mathematics hidden inside infinite staircases, hyperbolic tessellations, and recursive art.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
    ]

    for item in curated:
        CuratedVideo.objects.get_or_create(youtube_id=item['youtube_id'], defaults=item)


def _seed_mock_history():
    if SessionHistory.objects.count() >= 20:
        return

    now = timezone.now()

    # Pre-populate SessionHistory (e.g. 24 breaks started, 21 completed, 19 focus sessions)
    for i in range(19):
        day_offset = (19 - i) // 3
        start = now - timedelta(days=day_offset, hours=2 * (i % 4) + 1)
        SessionHistory.objects.create(
            session_type='FOCUS',
            task_name='Deep Work / Study',
            start_time=start,
            end_time=start + timedelta(minutes=50),
            planned_duration_minutes=50,
            actual_duration_minutes=50.0,
            completed=True
        )

    for i in range(24):
        day_offset = (24 - i) // 4
        start = now - timedelta(days=day_offset, hours=2 * (i % 4) + 2)
        is_completed = i < 21
        is_overrun = i in [5, 12, 18]
        actual = 25.0 if is_overrun else (17.5 + (i % 4) - 2)
        SessionHistory.objects.create(
            session_type='BREAK',
            task_name='Intentional Break',
            start_time=start,
            end_time=start + timedelta(minutes=int(actual)) if is_completed else None,
            planned_duration_minutes=20,
            actual_duration_minutes=actual if is_completed else 10.0,
            completed=is_completed,
            overrun=is_overrun,
            overrun_minutes=5.0 if is_overrun else 0.0
        )

    # Pre-populate boundary events matching prompt metrics:
    # 14 YouTube attempts during focus, 87 Shorts blocked, 18 Long videos watched
    for i in range(14):
        BoundaryEvent.objects.create(
            event_type='YOUTUBE_ATTEMPT_FOCUS',
            app_name='YouTube',
            target_url='https://www.youtube.com',
            timestamp=now - timedelta(days=(14 - i) // 2, hours=i % 6),
            note='Blocked YouTube launch while in focus session.'
        )

    for i in range(87):
        BoundaryEvent.objects.create(
            event_type='SHORTS_BLOCKED_BREAK',
            app_name='YouTube',
            target_url='https://www.youtube.com/shorts/feed',
            timestamp=now - timedelta(days=(87 - i) // 12, hours=i % 8),
            note='Intercepted Shorts tap during break mode. Filtered out.'
        )

    for i in range(18):
        BoundaryEvent.objects.create(
            event_type='LONG_VIDEO_WATCHED',
            app_name='YouTube',
            target_url='https://www.youtube.com/watch?v=4P8fKd0IVWE',
            timestamp=now - timedelta(days=(18 - i) // 3, hours=i % 7),
            note='Intentional long-form video watched during scheduled break.'
        )
