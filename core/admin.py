from django.contrib import admin
from .models import YouTubeChannel, CuratedVideo, FocusState, SessionHistory, BoundaryEvent, ProtectedApp


@admin.register(YouTubeChannel)
class YouTubeChannelAdmin(admin.ModelAdmin):
    list_display = ('name', 'handle', 'subscriber_count', 'video_count', 'created_at')
    search_fields = ('name', 'handle', 'description')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(CuratedVideo)
class CuratedVideoAdmin(admin.ModelAdmin):
    list_display = ('title', 'channel', 'duration_str', 'category', 'is_saved', 'created_at')
    list_filter = ('category', 'is_saved')
    search_fields = ('title', 'channel', 'description')


@admin.register(FocusState)
class FocusStateAdmin(admin.ModelAdmin):
    list_display = ('mode', 'task_name', 'planned_duration_minutes', 'start_time')


@admin.register(SessionHistory)
class SessionHistoryAdmin(admin.ModelAdmin):
    list_display = ('session_type', 'task_name', 'start_time', 'actual_duration_minutes', 'completed', 'overrun')


@admin.register(BoundaryEvent)
class BoundaryEventAdmin(admin.ModelAdmin):
    list_display = ('event_type', 'app_name', 'timestamp', 'note')
    list_filter = ('event_type', 'app_name')


@admin.register(ProtectedApp)
class ProtectedAppAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_enabled', 'special_rule')

