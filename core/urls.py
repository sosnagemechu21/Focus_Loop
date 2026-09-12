from django.urls import path
from . import views

urlpatterns = [
    # Pages
    path('', views.index_view, name='index'),
    path('blocked/', views.blocked_view, name='blocked'),

    # REST APIs
    path('api/status/', views.api_status, name='api_status'),
    path('api/connect/', views.api_connect, name='api_connect'),
    path('api/validate-video/', views.api_validate_video, name='api_validate_video'),
    path('api/focus/start/', views.api_focus_start, name='api_focus_start'),
    path('api/focus/end/', views.api_focus_end, name='api_focus_end'),
    path('api/break/start/', views.api_break_start, name='api_break_start'),
    path('api/break/end/', views.api_break_end, name='api_break_end'),
    path('api/events/log/', views.api_log_event, name='api_log_event'),
    path('api/analytics/', views.api_analytics, name='api_analytics'),
    path('api/videos/', views.api_videos, name='api_videos'),
    path('api/videos/<int:video_id>/save/', views.api_toggle_saved_video, name='api_toggle_saved_video'),
    path('api/videos/save-by-ytid/', views.api_save_by_youtube_id, name='api_save_by_youtube_id'),
    path('api/channels/', views.api_channels, name='api_channels'),
    path('api/channels/add/', views.api_channels_add, name='api_channels_add'),
    path('api/channels/popular/', views.api_channels_popular, name='api_channels_popular'),
    path('api/channels/<int:channel_id>/', views.api_channel_detail, name='api_channel_detail'),
    path('api/channels/<int:channel_id>/videos/', views.api_channel_videos, name='api_channel_videos'),
    path('api/settings/', views.api_settings, name='api_settings'),
    path('api/seed/', views.api_seed_data, name='api_seed_data'),
]
