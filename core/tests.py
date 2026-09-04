import json
from django.test import TestCase, Client
from django.utils import timezone
from datetime import timedelta
from .models import FocusState, SessionHistory, BoundaryEvent, CuratedVideo, ProtectedApp


class FocusGuardBoundaryTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.state = FocusState.get_current()
        self.state.mode = 'FOCUS'
        self.state.save()

    def test_initial_status_api(self):
        response = self.client.get('/api/status/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['mode'], 'FOCUS')
        self.assertIn('remaining_seconds', data)
        self.assertIn('today', data)

    def test_break_lifecycle(self):
        # 1. Start break
        res = self.client.post('/api/break/start/', 
                               json.dumps({'duration_minutes': 20}),
                               content_type='application/json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['mode'], 'BREAK')

        # Verify state in DB
        state = FocusState.get_current()
        self.assertEqual(state.mode, 'BREAK')
        self.assertEqual(state.planned_duration_minutes, 20)

        # 2. End break
        res_end = self.client.post('/api/break/end/')
        self.assertEqual(res_end.status_code, 200)
        self.assertEqual(res_end.json()['mode'], 'FOCUS')

        # Verify state is locked back to FOCUS
        state = FocusState.get_current()
        self.assertEqual(state.mode, 'FOCUS')

        # Verify SessionHistory was created
        break_sessions = SessionHistory.objects.filter(session_type='BREAK')
        self.assertTrue(break_sessions.exists())

    def test_log_temptation_and_shorts_events(self):
        # Log YouTube attempt during focus
        res1 = self.client.post('/api/events/log/', 
                                json.dumps({
                                    'event_type': 'YOUTUBE_ATTEMPT_FOCUS',
                                    'app_name': 'YouTube',
                                    'target_url': 'https://youtube.com',
                                    'note': 'Blocked in focus'
                                }),
                                content_type='application/json')
        self.assertEqual(res1.status_code, 200)

        # Log Shorts blocked during break
        res2 = self.client.post('/api/events/log/', 
                                json.dumps({
                                    'event_type': 'SHORTS_BLOCKED_BREAK',
                                    'app_name': 'YouTube',
                                    'target_url': 'https://youtube.com/shorts',
                                    'note': 'Shorts filtered out'
                                }),
                                content_type='application/json')
        self.assertEqual(res2.status_code, 200)

        self.assertEqual(BoundaryEvent.objects.filter(event_type='YOUTUBE_ATTEMPT_FOCUS').count(), 1)
        self.assertEqual(BoundaryEvent.objects.filter(event_type='SHORTS_BLOCKED_BREAK').count(), 1)

    def test_analytics_api_structure(self):
        # Create dummy events
        BoundaryEvent.objects.create(event_type='YOUTUBE_ATTEMPT_FOCUS', app_name='YouTube')
        BoundaryEvent.objects.create(event_type='SHORTS_BLOCKED_BREAK', app_name='YouTube')
        SessionHistory.objects.create(session_type='BREAK', planned_duration_minutes=20, actual_duration_minutes=18, completed=True)

        res = self.client.get('/api/analytics/')
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertIn('metrics_table', data)
        self.assertIn('friction_report', data)
        self.assertIn('weekly_trend', data)
        self.assertIn('narrative', data)

        # Check narrative fields
        self.assertIn('Your breaks are getting healthier', data['narrative']['headline'])
        self.assertIn('youtube_attempts_during_focus', data['metrics_table'])

    def test_curated_videos_and_surprise(self):
        CuratedVideo.objects.create(
            title='Test Long-Form Video Essay',
            channel='Deep Ideas',
            duration_str='35m',
            duration_minutes=35,
            youtube_id='abc123xyz',
            category='Philosophy'
        )

        res = self.client.get('/api/videos/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.json()['videos']), 1)

        res_surprise = self.client.get('/api/videos/?surprise=true')
        self.assertEqual(res_surprise.status_code, 200)
        self.assertIn('video', res_surprise.json())
