import json
from django.test import TestCase, Client
from django.utils import timezone
from datetime import timedelta
from .models import FocusState, SessionHistory, BoundaryEvent, CuratedVideo, ProtectedApp, YouTubeChannel



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

    def test_shorts_quarantine_logic(self):
        from core.youtube_service import is_short_video, parse_iso8601_duration

        # Test ISO 8601 duration parser
        self.assertEqual(parse_iso8601_duration('PT45S'), 45)
        self.assertEqual(parse_iso8601_duration('PT1M15S'), 75)
        self.assertEqual(parse_iso8601_duration('PT1H20M'), 4800)

        # Videos <= 60 seconds are ALWAYS shorts
        self.assertTrue(is_short_video(title='Funny Clip', duration_seconds=45))
        self.assertTrue(is_short_video(title='Quick Tip', duration_seconds=60))
        self.assertTrue(is_short_video(title='Sample', duration_str='0:45'))

        # Videos with #shorts or reel endpoints are ALWAYS shorts
        self.assertTrue(is_short_video(title='Amazing Hack #shorts', duration_seconds=120))
        self.assertTrue(is_short_video(title='Daily Reel', url_or_endpoint='https://youtube.com/shorts/xyz'))

        # Genuine long-form videos (> 60s without shorts tags) are NOT shorts
        self.assertFalse(is_short_video(title='Deep Space Documentary', duration_seconds=1800, duration_str='30m'))
        self.assertFalse(is_short_video(title='How Computers Calculate', duration_seconds=900, duration_str='15m'))

    def test_channels_api_lifecycle(self):
        # 1. Create test channel
        chan = YouTubeChannel.objects.create(
            name='Test Tech Channel',
            handle='@testtech',
            subscriber_count='1.2M subscribers',
            video_count=2
        )
        vid1 = CuratedVideo.objects.create(
            channel_ref=chan,
            title='Understanding CPU Architecture',
            channel=chan.name,
            duration_str='28m',
            duration_minutes=28,
            youtube_id='cpu_arch_123'
        )
        vid2 = CuratedVideo.objects.create(
            channel_ref=chan,
            title='Compiler Design Deep Dive',
            channel=chan.name,
            duration_str='45m',
            duration_minutes=45,
            youtube_id='compiler_456'
        )

        # 2. Test GET /api/channels/
        res_list = self.client.get('/api/channels/')
        self.assertEqual(res_list.status_code, 200)
        data = res_list.json()
        self.assertIn('channels', data)
        self.assertTrue(any(c['handle'] == '@testtech' for c in data['channels']))

        # 3. Test GET /api/channels/<id>/videos/
        res_videos = self.client.get(f'/api/channels/{chan.id}/videos/')
        self.assertEqual(res_videos.status_code, 200)
        v_data = res_videos.json()
        self.assertEqual(len(v_data['videos']), 2)
        self.assertEqual(v_data['channel']['name'], 'Test Tech Channel')

        # 4. Test GET /api/channels/popular/
        res_pop = self.client.get('/api/channels/popular/')
        self.assertEqual(res_pop.status_code, 200)
        self.assertTrue(len(res_pop.json()['popular']) >= 3)

        # 5. Test DELETE /api/channels/<id>/
        res_del = self.client.delete(f'/api/channels/{chan.id}/')
        self.assertEqual(res_del.status_code, 200)
        self.assertFalse(YouTubeChannel.objects.filter(id=chan.id).exists())



