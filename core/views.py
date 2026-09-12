import json
import random
from datetime import timedelta
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.db.models import Avg, Sum, Count

from .models import FocusState, SessionHistory, BoundaryEvent, CuratedVideo, ProtectedApp, YouTubeChannel
from .youtube_service import YouTubeService



def index_view(request):
    """Main dashboard & phone simulator"""
    return render(request, 'index.html')


def blocked_view(request):
    """Rendered when a blocked app or YouTube in focus mode is intercepted"""
    app = request.GET.get('app', 'YouTube')
    reason = request.GET.get('reason', 'focus_locked')
    return render(request, 'blocked.html', {'app': app, 'reason': reason})


def api_status(request):
    """Current state of focus/break, timers, and today's summary"""
    email = request.GET.get('email')
    state = FocusState.get_for_email(email)
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
        curated = CuratedVideo.objects.filter(youtube_id=video_id).first()
        title = curated.title if curated else 'Custom Long-Form Video'
        channel = curated.channel if curated else 'YouTube'
        category = curated.category if curated else 'Curated'
        duration = curated.duration_str if curated else 'Long-form'
        thumbnail = curated.thumbnail_url if curated and curated.thumbnail_url else f'https://i.ytimg.com/vi/{video_id}/hqdefault.jpg'
        description = curated.description if curated else 'Intentional long-form video loaded during scheduled break.'

        return JsonResponse({
            'status': 'ok',
            'is_short': False,
            'video_id': video_id,
            'title': title,
            'channel': channel,
            'category': category,
            'duration': duration,
            'thumbnail_url': thumbnail,
            'description': description
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
    email = data.get('email')
    request.session['break_minutes'] = break_duration

    state = FocusState.get_for_email(email)

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
    data = json.loads(request.body) if request.body else {}
    email = data.get('email')
    state = FocusState.get_for_email(email)
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
    email = data.get('email')

    state = FocusState.get_for_email(email)

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
    """End a break session and return to idle"""
    data = json.loads(request.body) if request.body else {}
    email = data.get('email')
    state = FocusState.get_for_email(email)
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
    """Log events from the frontend or extension"""
    data = json.loads(request.body) if request.body else {}
    email = data.get('email')
    
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


_SEARCH_CACHE = {}

def _search_youtube_live(query):
    """Fetch live YouTube search results, cache them, and strictly filter out Shorts"""
    import urllib.request
    import urllib.parse
    import re
    import json

    q_clean = query.strip().lower()
    if q_clean in _SEARCH_CACHE:
        return _SEARCH_CACHE[q_clean]

    try:
        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        )
        with urllib.request.urlopen(req, timeout=14) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
            m = re.search(r'var ytInitialData = ({.*?});</script>', html)
            if not m:
                return []
            data = json.loads(m.group(1))
            videos = []
            contents = data.get('contents', {}).get('twoColumnSearchResultsRenderer', {}).get('primaryContents', {}).get('sectionListRenderer', {}).get('contents', [])
            for section in contents:
                items = section.get('itemSectionRenderer', {}).get('contents', [])
                for item in items:
                    v = item.get('videoRenderer')
                    if not v:
                        continue
                    video_id = v.get('videoId')
                    title = v.get('title', {}).get('runs', [{}])[0].get('text', '')
                    channel = v.get('ownerText', {}).get('runs', [{}])[0].get('text', '')
                    duration = v.get('lengthText', {}).get('simpleText', '')
                    
                    # STRICT SHORTS FILTER
                    endpoint_str = json.dumps(v.get('navigationEndpoint', {})).lower()
                    is_short = (
                        not duration or
                        'reel' in endpoint_str or
                        'shorts' in endpoint_str or
                        '#shorts' in title.lower() or
                        '#short' in title.lower()
                    )
                    if is_short or not video_id:
                        continue

                    thumbs = v.get('thumbnail', {}).get('thumbnails', [])
                    thumb_url = thumbs[-1]['url'] if thumbs else f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
                    if thumb_url.startswith('//'):
                        thumb_url = 'https:' + thumb_url

                    desc_runs = v.get('detailedMetadataSnippets', [{}])[0].get('snippetText', {}).get('runs', [])
                    desc = ''.join([r.get('text', '') for r in desc_runs]) or f"YouTube video by {channel}"

                    # Save / sync to CuratedVideo so DB has it cached
                    try:
                        CuratedVideo.objects.get_or_create(
                            youtube_id=video_id,
                            defaults={
                                'title': title,
                                'channel': channel,
                                'duration_str': duration,
                                'duration_minutes': 20,
                                'category': 'YouTube',
                                'thumbnail_url': thumb_url,
                                'description': desc,
                            }
                        )
                    except Exception:
                        pass

                    videos.append({
                        'id': video_id,
                        'youtube_id': video_id,
                        'title': title,
                        'channel': channel,
                        'duration': duration,
                        'duration_minutes': 20,
                        'category': 'YouTube',
                        'thumbnail_url': thumb_url,
                        'description': desc,
                        'is_saved': False
                    })
                    if len(videos) >= 24:
                        break
                if len(videos) >= 24:
                    break

            _SEARCH_CACHE[q_clean] = videos
            return videos
    except Exception as e:
        print("Live YouTube search exception:", e)
        return []


def api_videos(request):
    """Curated and live long-form videos with categories, search query, saved filtering, and surprise me"""
    if CuratedVideo.objects.count() == 0:
        _seed_curated_videos()

    category = request.GET.get('category')
    surprise = request.GET.get('surprise') == 'true'
    q = request.GET.get('q', '').strip()

    videos = CuratedVideo.objects.all()

    if q:
        from django.db.models import Q
        q_filter = (
            Q(title__icontains=q) |
            Q(description__icontains=q) |
            Q(channel__icontains=q) |
            Q(category__icontains=q)
        )
        filtered = videos.filter(q_filter)
        if category and category != 'All':
            cat_filtered = filtered.filter(category__iexact=category)
            if cat_filtered.exists():
                videos = cat_filtered
            else:
                # If specific category yielded no matches, search all categories for query
                videos = filtered
        else:
            videos = filtered
    elif category and category != 'All':
        videos = videos.filter(category__iexact=category)

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
            'thumbnail_url': video.thumbnail_url
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
            'thumbnail_url': v.thumbnail_url
        })

    # If user searched for a term, query live YouTube so real channels like "donkey tube" work!
    if q:
        live_results = _search_youtube_live(q)
        existing_ids = {str(item['youtube_id']) for item in data}
        for item in live_results:
            if str(item['youtube_id']) not in existing_ids:
                data.append(item)
                existing_ids.add(str(item['youtube_id']))

    return JsonResponse({'videos': data})



def api_channels(request):
    """List all ingested YouTube channels"""
    channels = YouTubeChannel.objects.all()
    data = []
    for c in channels:
        v_count = c.videos.count() if hasattr(c, 'videos') else c.video_count
        data.append({
            'id': c.id,
            'name': c.name,
            'handle': c.handle or '',
            'channel_id': c.channel_id or '',
            'custom_url': c.custom_url or f"https://www.youtube.com/{c.handle}",
            'avatar_url': c.avatar_url,
            'description': c.description,
            'subscriber_count': c.subscriber_count,
            'video_count': v_count,
            'created_at': c.created_at.strftime('%b %d, %Y')
        })
    return JsonResponse({'channels': data, 'count': len(data)})


@csrf_exempt
def api_channels_add(request):
    """
    Backend entry point to ingest any YouTube channel.
    Strictly excludes all Shorts and imports only intentional long-form videos.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST method required'}, status=405)

    try:
        data = json.loads(request.body) if request.body else {}
    except Exception:
        data = {}

    identifier = (data.get('input') or data.get('channel') or data.get('handle') or '').strip()
    if not identifier:
        return JsonResponse({'status': 'error', 'message': 'No channel handle, URL, or name provided.'}, status=400)

    max_videos = int(data.get('max_videos', 40))
    result = YouTubeService.ingest_channel(identifier, max_videos=max_videos)
    status_code = 200 if result.get('status') == 'ok' else 400
    return JsonResponse(result, status=status_code)


@csrf_exempt
def api_channel_detail(request, channel_id):
    """Retrieve or delete an ingested YouTube channel"""
    try:
        channel = YouTubeChannel.objects.get(id=channel_id)
    except YouTubeChannel.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Channel not found'}, status=404)

    if request.method == 'DELETE':
        channel_name = channel.name
        channel.delete()
        return JsonResponse({'status': 'ok', 'message': f"Channel '{channel_name}' removed."})

    return JsonResponse({
        'status': 'ok',
        'channel': {
            'id': channel.id,
            'name': channel.name,
            'handle': channel.handle,
            'avatar_url': channel.avatar_url,
            'description': channel.description,
            'subscriber_count': channel.subscriber_count,
            'video_count': channel.videos.count()
        }
    })


def api_channel_videos(request, channel_id):
    """Get all long-form videos from a specific channel (Shorts strictly quarantined)"""
    try:
        channel = YouTubeChannel.objects.get(id=channel_id)
    except YouTubeChannel.DoesNotExist:
        return JsonResponse({'status': 'error', 'message': 'Channel not found'}, status=404)

    videos = channel.videos.all()
    if not videos.exists():
        # Fallback by channel name match if videos weren't linked by foreign key
        from django.db.models import Q
        videos = CuratedVideo.objects.filter(Q(channel__iexact=channel.name) | Q(channel_ref=channel))

    data = [{
        'id': v.id,
        'youtube_id': v.youtube_id,
        'title': v.title,
        'channel': v.channel,
        'duration': v.duration_str,
        'duration_minutes': v.duration_minutes,
        'category': v.category,
        'thumbnail_url': v.thumbnail_url,
        'description': v.description,
        'is_saved': v.is_saved
    } for v in videos]

    return JsonResponse({
        'channel': {
            'id': channel.id,
            'name': channel.name,
            'handle': channel.handle,
            'avatar_url': channel.avatar_url,
            'subscriber_count': channel.subscriber_count,
            'description': channel.description,
            'video_count': len(data)
        },
        'videos': data
    })


def api_channels_popular(request):
    """Preset list of popular intentional channels that can be added with 1-click"""
    popular = [
        {'name': 'Veritasium', 'handle': '@veritasium', 'category': 'Science & Tech', 'avatar': 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=100&auto=format&fit=crop&q=80', 'desc': 'An element of truth - videos about science, education, and anything interesting.'},
        {'name': '3Blue1Brown', 'handle': '@3blue1brown', 'category': 'Coding & Math', 'avatar': 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=100&auto=format&fit=crop&q=80', 'desc': 'Animating math and visual explanations of deep concepts.'},
        {'name': 'Kurzgesagt', 'handle': '@kurzgesagt', 'category': 'Science & Tech', 'avatar': 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=100&auto=format&fit=crop&q=80', 'desc': 'Videos explaining things with optimistic nihilism.'},
        {'name': 'Donkey Tube', 'handle': '@DonkeyTube', 'category': 'Entertainment & Culture', 'avatar': 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=100&auto=format&fit=crop&q=80', 'desc': 'Heartwarming long-form interviews, essays, and cultural stories by Comedian Eshetu.'},
        {'name': 'Great Art Explained', 'handle': '@greatartexplained', 'category': 'Art & Essays', 'avatar': 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=100&auto=format&fit=crop&q=80', 'desc': 'Focusing on one great work of art at a time, looking at it in detail.'},
        {'name': 'Huberman Lab', 'handle': '@hubermanlab', 'category': 'Science & Health', 'avatar': 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=100&auto=format&fit=crop&q=80', 'desc': 'Neuroscience and science-based tools for everyday life.'}
    ]
    return JsonResponse({'popular': popular})



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
            'category': 'Nature',
            'description': 'How tree cover drastically reduces ambient temperatures, improves mental cognition, and heals urban environments.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'Lofi Hip Hop Radio: Beats to Relax/Study to',
            'channel': 'Lofi Girl',
            'duration_str': '180m',
            'duration_minutes': 180,
            'youtube_id': 'jfKfPfyJRdk',
            'category': 'Music & Focus',
            'description': 'Gentle chillhop melodies designed for sustained deep focus and relaxation during breaks.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=600&auto=format&fit=crop&q=80',
            'is_saved': True
        },
        {
            'title': 'How Caravaggio Mastered Light and Shadow',
            'channel': 'Great Art Explained',
            'duration_str': '22m',
            'duration_minutes': 22,
            'youtube_id': 'y7r2G73g2a8',
            'category': 'Art & Essays',
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
        {
            'title': 'Neural Networks from Scratch: The Essence of Deep Learning',
            'channel': '3Blue1Brown',
            'duration_str': '35m',
            'duration_minutes': 35,
            'youtube_id': 'aircAruvnKk',
            'category': 'Coding & Math',
            'description': 'A breathtaking visual journey uncovering what artificial intelligence really is under the hood.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'How Mechanical Watches Work Without Batteries',
            'channel': 'Animagraffs',
            'duration_str': '25m',
            'duration_minutes': 25,
            'youtube_id': 'p3Akn4rC-F8',
            'category': 'Engineering',
            'description': 'Microscopic balance wheels, mainsprings, and escapements working in harmony.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'The Deep Ocean: Secrets of the Mariana Trench',
            'channel': 'Ocean Documentaries',
            'duration_str': '42m',
            'duration_minutes': 42,
            'youtube_id': 'W93XyXhGYQY',
            'category': 'Nature',
            'description': 'Descend 11,000 meters into pitch-black pressure to observe bizarre bioluminescent deep-sea organisms.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'How The Apollo Guidance Computer Worked in 1969',
            'channel': 'Computer History Archives',
            'duration_str': '38m',
            'duration_minutes': 38,
            'youtube_id': '1-xGerv5FOk',
            'category': 'Science & Tech',
            'description': 'How rope core memory and simple logic chips guided humanity safely to the lunar surface.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'The Architecture of Antoni Gaudi: Sagrada Familia',
            'channel': 'Design Chronicles',
            'duration_str': '29m',
            'duration_minutes': 29,
            'youtube_id': 'z9bZkjdzGek',
            'category': 'Art & Essays',
            'description': 'How nature-inspired organic catenary arches transformed the skyline of Barcelona.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1583772654849-08288b93b554?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'Why the Renaissance Happened Where and When It Did',
            'channel': 'History Deep Dives',
            'duration_str': '40m',
            'duration_minutes': 40,
            'youtube_id': 'L_LUpnjgPso',
            'category': 'History',
            'description': 'Commerce, Mediterranean trade routes, and rediscovery of ancient manuscripts that birthed modernity.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'How Quantum Computers Break Classical Physics',
            'channel': 'Kurzgesagt Focus',
            'duration_str': '21m',
            'duration_minutes': 21,
            'youtube_id': 'v68zYya58qA',
            'category': 'Science & Tech',
            'description': 'Qubits, superposition, and entanglement explained simply with stunning animation.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'Deep Work Ambient Soundscapes & White Noise',
            'channel': 'Sound Therapy Studio',
            'duration_str': '120m',
            'duration_minutes': 120,
            'youtube_id': 'M576WGiDBdQ',
            'category': 'Music & Focus',
            'description': 'Isochronic tones and soothing brown noise to quiet autopilot distraction loops.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'How Jet Engines Produce 100,000 Pounds of Thrust',
            'channel': 'Aviation Pioneers',
            'duration_str': '27m',
            'duration_minutes': 27,
            'youtube_id': 'gXk1uK6n9Xg',
            'category': 'Engineering',
            'description': 'Turbofan thermodynamics, compression stages, and titanium turbine blades operating above melting points.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'The Rise and Fall of the Roman Republic',
            'channel': 'Classical Antiquity',
            'duration_str': '48m',
            'duration_minutes': 48,
            'youtube_id': '2S_7o7l2gG4',
            'category': 'History',
            'description': 'From the Gracchi reforms to the Rubicon crossing: how institutional erosion broke a republic.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'Synthwave Chill Radio: Retro 80s Cyberpunk Focus',
            'channel': 'NightDrive Beats',
            'duration_str': '90m',
            'duration_minutes': 90,
            'youtube_id': '4xDzrJKXOOY',
            'category': 'Music & Focus',
            'description': 'Analog synthesizers, arpeggiated basslines, and retro vibes for coding and creative work.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'The Secret Biological Language of Forests',
            'channel': 'Ecology Horizon',
            'duration_str': '33m',
            'duration_minutes': 33,
            'youtube_id': 'kYfNvmF0Bqw',
            'category': 'Nature',
            'description': 'Mycelial underground networks that share nutrients, warn neighboring trees of pests, and maintain equilibrium.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'Donkey Tube: ድንቅ ልጆች (Dink Lejoch) - Season Special with Comedian Eshetu',
            'channel': 'Donkey Tube',
            'duration_str': '48m',
            'duration_minutes': 48,
            'youtube_id': '4kX3Z7l2gG4',
            'category': 'Entertainment & Culture',
            'description': 'Full length intentional episode from Donkey Tube featuring brilliant young minds and heartwarming interviews by Comedian Eshetu Melese.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'Donkey Tube: Inspiring Ethiopian Innovators & Creative Minds',
            'channel': 'Donkey Tube',
            'duration_str': '36m',
            'duration_minutes': 36,
            'youtube_id': '8mP9kK7e-v3',
            'category': 'Entertainment & Culture',
            'description': 'In-depth long-form conversation on Donkey Tube exploring resilience, ambition, and community impact.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        },
        {
            'title': 'Donkey Tube: The Journey of Comedian Eshetu Melese - Deep Dive Essay',
            'channel': 'Donkey Tube',
            'duration_str': '42m',
            'duration_minutes': 42,
            'youtube_id': 'YmZcQp4sB1Q',
            'category': 'Entertainment & Culture',
            'description': 'A retrospective on how Donkey Tube grew into one of the most prominent media and storytelling platforms in East Africa.',
            'thumbnail_url': 'https://images.unsplash.com/photo-1522869635100-9f4c5e86aa37?w=600&auto=format&fit=crop&q=80',
            'is_saved': False
        }
    ]

    for item in curated:
        CuratedVideo.objects.update_or_create(youtube_id=item['youtube_id'], defaults=item)


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
