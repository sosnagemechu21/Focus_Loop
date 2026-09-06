import os
import django
from datetime import timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'focusguard.settings')
django.setup()

from django.utils import timezone
from core.models import BoundaryEvent, SessionHistory, CuratedVideo, ProtectedApp
from core.views import _seed_curated_videos

print("Seeding curated videos...")
_seed_curated_videos()

now = timezone.now()

# Seed SessionHistory if needed
if SessionHistory.objects.count() < 24:
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

# Seed BoundaryEvents to match user prompt exactly:
# 14 YouTube attempts during focus, 87 Shorts blocked, 18 Long videos watched
current_yt = BoundaryEvent.objects.filter(event_type='YOUTUBE_ATTEMPT_FOCUS').count()
for i in range(current_yt, 14):
    BoundaryEvent.objects.create(
        event_type='YOUTUBE_ATTEMPT_FOCUS',
        app_name='YouTube',
        target_url='https://www.youtube.com',
        timestamp=now - timedelta(days=(14 - i) // 2, hours=i % 6),
        note='Blocked YouTube launch while in focus session.'
    )

current_shorts = BoundaryEvent.objects.filter(event_type='SHORTS_BLOCKED_BREAK').count()
for i in range(current_shorts, 87):
    BoundaryEvent.objects.create(
        event_type='SHORTS_BLOCKED_BREAK',
        app_name='YouTube',
        target_url='https://www.youtube.com/shorts/feed',
        timestamp=now - timedelta(days=(87 - i) // 12, hours=i % 8),
        note='Intercepted Shorts tap during break mode. Filtered out.'
    )

current_long = BoundaryEvent.objects.filter(event_type='LONG_VIDEO_WATCHED').count()
for i in range(current_long, 18):
    BoundaryEvent.objects.create(
        event_type='LONG_VIDEO_WATCHED',
        app_name='YouTube',
        target_url='https://www.youtube.com',
        timestamp=now - timedelta(days=(18 - i) // 3, hours=i % 7),
        note='Intentional long-form video watched during scheduled break.'
    )

default_apps = [
    {'name': 'YouTube', 'is_enabled': True, 'special_rule': 'During allowed breaks: Long-form only.', 'icon': 'youtube'},
    {'name': 'TikTok', 'is_enabled': True, 'special_rule': 'Always blocked during focus sessions.', 'icon': 'tiktok'},
    {'name': 'Instagram', 'is_enabled': True, 'special_rule': 'Always blocked during focus sessions.', 'icon': 'instagram'},
    {'name': 'Telegram', 'is_enabled': False, 'special_rule': 'Allowed for direct messaging.', 'icon': 'telegram'},
    {'name': 'Chrome', 'is_enabled': False, 'special_rule': 'Unrestricted work browsing.', 'icon': 'chrome'},
]
for item in default_apps:
    ProtectedApp.objects.get_or_create(name=item['name'], defaults=item)

print("Boundary telemetry seed complete!")
