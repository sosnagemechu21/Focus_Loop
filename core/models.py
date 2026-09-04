from django.db import models
from django.utils import timezone
from datetime import timedelta
import uuid


class FocusState(models.Model):
    MODE_CHOICES = [
        ('FOCUS', 'Focus Mode 🔒'),
        ('BREAK', 'Break Mode 🌿'),
        ('IDLE', 'Idle ⏸️'),
    ]

    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default='FOCUS')
    session_id = models.CharField(max_length=64, default=uuid.uuid4)
    task_name = models.CharField(max_length=120, default="Deep Work / Study")
    start_time = models.DateTimeField(default=timezone.now)
    planned_duration_minutes = models.IntegerField(default=50)
    next_break_time = models.DateTimeField(null=True, blank=True)
    active_video_id = models.CharField(max_length=100, blank=True, null=True)
    active_video_title = models.CharField(max_length=255, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Focus State"
        verbose_name_plural = "Focus State"

    @classmethod
    def get_current(cls):
        state, created = cls.objects.get_or_create(id=1)
        if created:
            state.start_time = timezone.now()
            state.planned_duration_minutes = 90
            state.next_break_time = timezone.now() + timedelta(minutes=90)
            state.save()
        return state

    @property
    def elapsed_seconds(self):
        if not self.start_time:
            return 0
        diff = (timezone.now() - self.start_time).total_seconds()
        return max(0, int(diff))

    @property
    def remaining_seconds(self):
        total_seconds = self.planned_duration_minutes * 60
        remaining = total_seconds - self.elapsed_seconds
        return max(0, remaining)

    @property
    def is_expired(self):
        return self.remaining_seconds <= 0


class SessionHistory(models.Model):
    SESSION_TYPE_CHOICES = [
        ('FOCUS', 'Focus Session'),
        ('BREAK', 'Break Session'),
    ]

    session_type = models.CharField(max_length=20, choices=SESSION_TYPE_CHOICES)
    task_name = models.CharField(max_length=120, default="Session")
    start_time = models.DateTimeField(default=timezone.now)
    end_time = models.DateTimeField(null=True, blank=True)
    planned_duration_minutes = models.IntegerField(default=20)
    actual_duration_minutes = models.FloatField(default=0.0)
    completed = models.BooleanField(default=True)
    overrun = models.BooleanField(default=False)
    overrun_minutes = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_time']

    def __str__(self):
        return f"{self.session_type} ({self.planned_duration_minutes}m) at {self.start_time.strftime('%Y-%m-%d %H:%M')}"


class BoundaryEvent(models.Model):
    EVENT_TYPES = [
        ('YOUTUBE_ATTEMPT_FOCUS', 'YouTube Blocked During Focus 🔒'),
        ('SHORTS_BLOCKED_BREAK', 'Shorts Intercepted During Break ❌'),
        ('APP_BLOCKED_FOCUS', 'Protected App Blocked 🚫'),
        ('BREAK_OVERRUN', 'Break Overrun ⚠️'),
        ('LONG_VIDEO_WATCHED', 'Long Video Watched ✅'),
        ('BREAK_COMPLETED', 'Break Completed On Time 🌿'),
    ]

    event_type = models.CharField(max_length=40, choices=EVENT_TYPES)
    app_name = models.CharField(max_length=60, default='YouTube')
    target_url = models.CharField(max_length=500, blank=True)
    timestamp = models.DateTimeField(default=timezone.now)
    note = models.CharField(max_length=255, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-timestamp']

    def __str__(self):
        return f"[{self.timestamp.strftime('%H:%M:%S')}] {self.get_event_type_display()}"


class CuratedVideo(models.Model):
    title = models.CharField(max_length=255)
    channel = models.CharField(max_length=120)
    duration_str = models.CharField(max_length=20, default="24m")
    duration_minutes = models.IntegerField(default=24)
    youtube_id = models.CharField(max_length=60)
    category = models.CharField(max_length=60, default="Documentary")
    description = models.TextField(blank=True)
    thumbnail_url = models.URLField(blank=True)
    is_saved = models.BooleanField(default=False)
    watch_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-is_saved', '-created_at']

    def __str__(self):
        return f"{self.title} ({self.channel})"


class ProtectedApp(models.Model):
    name = models.CharField(max_length=60, unique=True)
    is_enabled = models.BooleanField(default=True)
    special_rule = models.CharField(max_length=150, default="Blocked during focus")
    icon = models.CharField(max_length=40, default="shield")

    def __str__(self):
        return f"{self.name} ({'Protected' if self.is_enabled else 'Off'})"
