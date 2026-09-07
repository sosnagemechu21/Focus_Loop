import os
import re
import json
import urllib.request
import urllib.parse
from django.conf import settings
from .models import YouTubeChannel, CuratedVideo


def parse_iso8601_duration(duration_str):
    """
    Parses ISO 8601 duration string (e.g. PT1H23M45S, PT15M, PT45S) into total seconds.
    Returns total_seconds (int).
    """
    if not duration_str or not duration_str.startswith('PT'):
        return 0

    hours = 0
    minutes = 0
    seconds = 0

    h_match = re.search(r'(\d+)H', duration_str)
    m_match = re.search(r'(\d+)M', duration_str)
    s_match = re.search(r'(\d+)S', duration_str)

    if h_match:
        hours = int(h_match.group(1))
    if m_match:
        minutes = int(m_match.group(1))
    if s_match:
        seconds = int(s_match.group(1))

    return (hours * 3600) + (minutes * 60) + seconds


def format_duration_seconds(total_seconds):
    """Formats total seconds into friendly string like '24m' or '1h 12m'"""
    if total_seconds < 60:
        return f"{total_seconds}s"
    hours = total_seconds // 3600
    mins = (total_seconds % 3600) // 60
    if hours > 0:
        return f"{hours}h {mins}m"
    return f"{mins}m"


def is_short_video(title='', duration_seconds=0, duration_str='', url_or_endpoint=''):
    """
    Strict Shorts quarantine check:
    Returns True if video is a Short / reel / clip under 60 seconds.
    """
    # 1. Any video <= 60 seconds is classified as a short video
    if duration_seconds > 0 and duration_seconds <= 60:
        return True

    # 2. String check for short durations (e.g. "0:45", "0:30", "0:59", "45s")
    if duration_str:
        d_clean = duration_str.strip().lower()
        if re.match(r'^0:[0-5]\d$', d_clean) or (d_clean.endswith('s') and not 'm' in d_clean and not 'h' in d_clean):
            return True

    # 3. Explicit #shorts tag in title or endpoint
    combined = f"{title} {url_or_endpoint}".lower()
    if '#shorts' in combined or '#short' in combined or '/shorts/' in combined or 'reel' in combined:
        return True

    return False


def get_youtube_api_key():
    """Retrieves YouTube Data API v3 key from settings or environment"""
    return getattr(settings, 'YOUTUBE_API_KEY', os.environ.get('YOUTUBE_API_KEY', '')).strip()


class YouTubeService:
    """
    Engine for ingesting YouTube channels and videos via:
    1. Official Google YouTube Data API v3 (when API key is present)
    2. Zero-config live YouTube scraper fallback (when no API key is set)
    Always guarantees strict quarantine and exclusion of YouTube Shorts.
    """

    HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    }

    @classmethod
    def clean_channel_identifier(cls, raw_input):
        """Extracts clean handle, channel URL, or search query from raw user input"""
        raw = raw_input.strip()
        if not raw:
            return ''

        # Handle full URL e.g. https://www.youtube.com/@veritasium/videos
        if 'youtube.com' in raw or 'youtu.be' in raw:
            m = re.search(r'youtube\.com\/(@[\w\.-]+)', raw)
            if m:
                return m.group(1)
            m_chan = re.search(r'youtube\.com\/channel\/(UC[\w-]{22})', raw)
            if m_chan:
                return m_chan.group(1)
            m_c = re.search(r'youtube\.com\/c\/([\w\.-]+)', raw)
            if m_c:
                return m_c.group(1)
            m_user = re.search(r'youtube\.com\/user\/([\w\.-]+)', raw)
            if m_user:
                return m_user.group(1)

        # Normalize handle
        if raw.startswith('@'):
            return raw

        return raw

    @classmethod
    def fetch_via_api(cls, api_key, identifier, max_videos=50):
        """Fetches channel and uploads using Google YouTube Data API v3"""
        base_url = "https://www.googleapis.com/youtube/v3"

        # 1. Resolve Channel
        chan_query = {}
        clean_id = cls.clean_channel_identifier(identifier)
        if clean_id.startswith('UC') and len(clean_id) == 24:
            chan_query['id'] = clean_id
        elif clean_id.startswith('@'):
            chan_query['forHandle'] = clean_id
        else:
            # Search channel by name
            search_url = f"{base_url}/search?part=snippet&type=channel&q={urllib.parse.quote(clean_id)}&key={api_key}"
            req = urllib.request.Request(search_url, headers=cls.HEADERS)
            with urllib.request.urlopen(req, timeout=12) as resp:
                s_data = json.loads(resp.read().decode('utf-8'))
                items = s_data.get('items', [])
                if items:
                    chan_query['id'] = items[0]['snippet']['channelId']
                else:
                    return None

        param_str = urllib.parse.urlencode(chan_query)
        channel_url = f"{base_url}/channels?part=snippet,contentDetails,statistics&{param_str}&key={api_key}"
        req = urllib.request.Request(channel_url, headers=cls.HEADERS)
        with urllib.request.urlopen(req, timeout=12) as resp:
            c_data = json.loads(resp.read().decode('utf-8'))
            items = c_data.get('items', [])
            if not items:
                return None
            channel_item = items[0]

        snippet = channel_item.get('snippet', {})
        statistics = channel_item.get('statistics', {})
        content_details = channel_item.get('contentDetails', {})

        title = snippet.get('title', '')
        handle = snippet.get('customUrl', '') or (clean_id if clean_id.startswith('@') else f"@{clean_id}")
        channel_id = channel_item.get('id', '')
        avatar = snippet.get('thumbnails', {}).get('high', {}).get('url') or snippet.get('thumbnails', {}).get('default', {}).get('url', '')
        description = snippet.get('description', '')
        subscribers = statistics.get('subscriberCount', '')
        if subscribers and subscribers.isdigit():
            s_num = int(subscribers)
            if s_num >= 1000000:
                subscribers = f"{round(s_num / 1000000, 1)}M subscribers"
            elif s_num >= 1000:
                subscribers = f"{round(s_num / 1000, 1)}K subscribers"
            else:
                subscribers = f"{s_num} subscribers"

        uploads_playlist_id = content_details.get('relatedPlaylists', {}).get('uploads', '')
        if not uploads_playlist_id:
            uploads_playlist_id = 'UU' + channel_id[2:] if channel_id.startswith('UC') else ''

        # 2. Fetch Playlist Videos
        video_ids = []
        video_snippets = {}
        if uploads_playlist_id:
            pl_url = f"{base_url}/playlistItems?part=snippet,contentDetails&playlistId={uploads_playlist_id}&maxResults={min(50, max_videos)}&key={api_key}"
            try:
                req = urllib.request.Request(pl_url, headers=cls.HEADERS)
                with urllib.request.urlopen(req, timeout=12) as resp:
                    pl_data = json.loads(resp.read().decode('utf-8'))
                    for it in pl_data.get('items', []):
                        vid = it.get('contentDetails', {}).get('videoId')
                        if vid:
                            video_ids.append(vid)
                            video_snippets[vid] = it.get('snippet', {})
            except Exception as e:
                print("YouTube API playlist fetch error:", e)

        # 3. Fetch exact duration for each video to strictly filter out Shorts
        long_videos = []
        shorts_quarantined = 0

        if video_ids:
            chunk_size = 50
            for i in range(0, len(video_ids), chunk_size):
                chunk = video_ids[i:i + chunk_size]
                v_url = f"{base_url}/videos?part=snippet,contentDetails&id={','.join(chunk)}&key={api_key}"
                try:
                    req = urllib.request.Request(v_url, headers=cls.HEADERS)
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        v_data = json.loads(resp.read().decode('utf-8'))
                        for v in v_data.get('items', []):
                            vid = v.get('id')
                            v_snip = v.get('snippet', {})
                            v_content = v.get('contentDetails', {})
                            v_title = v_snip.get('title', '')
                            duration_iso = v_content.get('duration', '')
                            duration_sec = parse_iso8601_duration(duration_iso)

                            # STRICT SHORTS EXCLUSION
                            if is_short_video(title=v_title, duration_seconds=duration_sec):
                                shorts_quarantined += 1
                                continue

                            v_desc = v_snip.get('description', '') or f"Video from {title}"
                            v_thumb = v_snip.get('thumbnails', {}).get('high', {}).get('url') or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                            dur_str = format_duration_seconds(duration_sec)

                            long_videos.append({
                                'youtube_id': vid,
                                'title': v_title,
                                'channel': title,
                                'duration_str': dur_str,
                                'duration_minutes': max(1, duration_sec // 60),
                                'category': 'YouTube',
                                'description': v_desc[:500],
                                'thumbnail_url': v_thumb
                            })
                except Exception as e:
                    print("YouTube API videos details fetch error:", e)

        return {
            'channel_info': {
                'name': title,
                'handle': handle,
                'channel_id': channel_id,
                'custom_url': f"https://www.youtube.com/{handle}" if handle else f"https://www.youtube.com/channel/{channel_id}",
                'avatar_url': avatar,
                'description': description,
                'subscriber_count': subscribers
            },
            'videos': long_videos,
            'shorts_excluded': shorts_quarantined
        }

    @classmethod
    def fetch_via_scraper_fallback(cls, identifier, max_videos=50):
        """
        Zero-config fallback: extracts channel profile and uploads directly
        from live YouTube, strictly excluding all shorts.
        """
        clean = cls.clean_channel_identifier(identifier)
        if not clean:
            return None

        # Determine target URL
        if clean.startswith('@'):
            target_url = f"https://www.youtube.com/{clean}/videos"
        elif clean.startswith('UC') and len(clean) == 24:
            target_url = f"https://www.youtube.com/channel/{clean}/videos"
        else:
            # Search YouTube for channel
            target_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(clean)}"

        try:
            req = urllib.request.Request(target_url, headers=cls.HEADERS)
            try:
                with urllib.request.urlopen(req, timeout=14) as resp:
                    html = resp.read().decode('utf-8', errors='ignore')
            except urllib.error.HTTPError as he:
                if he.code == 404 and clean.startswith('@'):
                    # Handle might be slightly different; fallback to channel search
                    target_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(clean.replace('@', '') + ' channel')}"
                    req = urllib.request.Request(target_url, headers=cls.HEADERS)
                    with urllib.request.urlopen(req, timeout=14) as resp:
                        html = resp.read().decode('utf-8', errors='ignore')
                else:
                    raise

            m = re.search(r'var ytInitialData = ({.*?});</script>', html)
            if not m:
                return None

            data = json.loads(m.group(1))


            # Extract Channel Metadata
            channel_name = ''
            channel_handle = clean if clean.startswith('@') else ''
            avatar_url = ''
            subscriber_count = ''
            description = ''

            # Try header renderer
            header = data.get('header', {}).get('c4TabbedHeaderRenderer') or data.get('header', {}).get('pageHeaderRenderer')
            if header:
                if 'c4TabbedHeaderRenderer' in str(header):
                    channel_name = header.get('title', '')
                    avatar_url = header.get('avatar', {}).get('thumbnails', [{}])[-1].get('url', '')
                    subscriber_count = header.get('subscriberCountText', {}).get('simpleText', '')
                elif 'content' in header:
                    content_block = header.get('content', {}).get('pageHeaderViewModel', {})
                    channel_name = content_block.get('title', {}).get('dynamicTextViewModel', {}).get('text', {}).get('content', '')
                    avatar_url = content_block.get('image', {}).get('decoratedAvatarViewModel', {}).get('avatar', {}).get('avatarViewModel', {}).get('image', {}).get('sources', [{}])[-1].get('url', '')

            # Fallback channel info from metadata
            meta = data.get('metadata', {}).get('channelMetadataRenderer', {})
            if not channel_name and meta:
                channel_name = meta.get('title', '')
                avatar_url = avatar_url or meta.get('avatar', {}).get('thumbnails', [{}])[-1].get('url', '')
                description = meta.get('description', '')
                if not channel_handle:
                    channel_handle = meta.get('vanityChannelUrl', '').split('/')[-1]

            if not channel_name:
                channel_name = clean.replace('@', '').replace('_', ' ').title()

            if not channel_handle:
                channel_handle = f"@{channel_name.replace(' ', '')}"
            elif not channel_handle.startswith('@'):
                channel_handle = f"@{channel_handle}"

            if avatar_url.startswith('//'):
                avatar_url = 'https:' + avatar_url

            # Extract Videos
            long_videos = []
            shorts_quarantined = 0

            # Scan tabs for videos
            tabs = data.get('contents', {}).get('twoColumnBrowseResultsRenderer', {}).get('tabs', [])
            for tab in tabs:
                tab_content = tab.get('tabRenderer', {}).get('content', {})
                grid = tab_content.get('richGridRenderer', {}) or tab_content.get('sectionListRenderer', {})
                
                # Check contents array
                items = grid.get('contents', [])
                for item in items:
                    v = item.get('richItemRenderer', {}).get('content', {}).get('videoRenderer')
                    if not v:
                        v = item.get('videoRenderer')
                    if not v:
                        continue

                    vid = v.get('videoId')
                    v_title = v.get('title', {}).get('runs', [{}])[0].get('text', '')
                    v_duration = v.get('lengthText', {}).get('simpleText', '')
                    
                    endpoint_str = json.dumps(v.get('navigationEndpoint', {})).lower()

                    # STRICT SHORTS FILTER
                    if is_short_video(title=v_title, duration_str=v_duration, url_or_endpoint=endpoint_str):
                        shorts_quarantined += 1
                        continue

                    if not vid:
                        continue

                    # Calculate minutes
                    dur_mins = 20
                    if v_duration and ':' in v_duration:
                        parts = v_duration.split(':')
                        try:
                            if len(parts) == 2:
                                dur_mins = max(1, int(parts[0]))
                            elif len(parts) == 3:
                                dur_mins = int(parts[0]) * 60 + int(parts[1])
                        except Exception:
                            dur_mins = 20

                    thumbs = v.get('thumbnail', {}).get('thumbnails', [])
                    v_thumb = thumbs[-1]['url'] if thumbs else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                    if v_thumb.startswith('//'):
                        v_thumb = 'https:' + v_thumb

                    desc_runs = v.get('detailedMetadataSnippets', [{}])[0].get('snippetText', {}).get('runs', [])
                    v_desc = ''.join([r.get('text', '') for r in desc_runs]) or f"Full long-form video from {channel_name}"

                    long_videos.append({
                        'youtube_id': vid,
                        'title': v_title,
                        'channel': channel_name,
                        'duration_str': v_duration or f"{dur_mins}m",
                        'duration_minutes': dur_mins,
                        'category': 'YouTube',
                        'description': v_desc,
                        'thumbnail_url': v_thumb
                    })
                    if len(long_videos) >= max_videos:
                        break

            # If no videos found from tabs, search query directly
            if not long_videos:
                search_target = f"https://www.youtube.com/results?search_query={urllib.parse.quote(clean + ' videos')}"
                req = urllib.request.Request(search_target, headers=cls.HEADERS)
                with urllib.request.urlopen(req, timeout=12) as resp:
                    html_s = resp.read().decode('utf-8', errors='ignore')
                m_s = re.search(r'var ytInitialData = ({.*?});</script>', html_s)
                if m_s:
                    s_data = json.loads(m_s.group(1))
                    sections = s_data.get('contents', {}).get('twoColumnSearchResultsRenderer', {}).get('primaryContents', {}).get('sectionListRenderer', {}).get('contents', [])
                    for sec in sections:
                        s_items = sec.get('itemSectionRenderer', {}).get('contents', [])
                        for it in s_items:
                            v = it.get('videoRenderer')
                            if not v:
                                continue
                            vid = v.get('videoId')
                            v_title = v.get('title', {}).get('runs', [{}])[0].get('text', '')
                            v_duration = v.get('lengthText', {}).get('simpleText', '')
                            endpoint_str = json.dumps(v.get('navigationEndpoint', {})).lower()

                            if is_short_video(title=v_title, duration_str=v_duration, url_or_endpoint=endpoint_str):
                                shorts_quarantined += 1
                                continue

                            if not vid:
                                continue

                            thumbs = v.get('thumbnail', {}).get('thumbnails', [])
                            v_thumb = thumbs[-1]['url'] if thumbs else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                            if v_thumb.startswith('//'):
                                v_thumb = 'https:' + v_thumb

                            dur_mins = 20
                            if v_duration and ':' in v_duration:
                                parts = v_duration.split(':')
                                try:
                                    dur_mins = int(parts[0]) if len(parts) == 2 else int(parts[0]) * 60 + int(parts[1])
                                except Exception:
                                    dur_mins = 20

                            long_videos.append({
                                'youtube_id': vid,
                                'title': v_title,
                                'channel': channel_name,
                                'duration_str': v_duration or f"{dur_mins}m",
                                'duration_minutes': max(1, dur_mins),
                                'category': 'YouTube',
                                'description': f"Video from {channel_name}",
                                'thumbnail_url': v_thumb
                            })
                            if len(long_videos) >= max_videos:
                                break

            return {
                'channel_info': {
                    'name': channel_name,
                    'handle': channel_handle,
                    'channel_id': None,
                    'custom_url': f"https://www.youtube.com/{channel_handle}",
                    'avatar_url': avatar_url or 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80',
                    'description': description or f"Official YouTube channel: {channel_name}",
                    'subscriber_count': subscriber_count or 'Creator'
                },
                'videos': long_videos,
                'shorts_excluded': shorts_quarantined
            }

        except Exception as e:
            print("Fallback channel scraper exception:", e)
            return None

    @classmethod
    def ingest_channel(cls, identifier, max_videos=40):
        """
        Primary entry point for the backend program:
        Takes any channel identifier, resolves it, applies strict Shorts quarantine,
        and saves the channel and long-form videos to SQLite database.
        """
        api_key = get_youtube_api_key()
        result = None

        if api_key:
            try:
                result = cls.fetch_via_api(api_key, identifier, max_videos=max_videos)
            except Exception as e:
                print(f"API key error: {e}. Falling back to live scraper.")
                result = None

        if not result or not result.get('channel_info'):
            result = cls.fetch_via_scraper_fallback(identifier, max_videos=max_videos)

        if not result or not result.get('channel_info'):
            return {
                'status': 'error',
                'message': f"Could not find or resolve YouTube channel for '{identifier}'."
            }

        info = result['channel_info']
        videos = result.get('videos', [])
        shorts_count = result.get('shorts_excluded', 0)

        # 1. Create or Update YouTubeChannel in DB
        lookup_kwargs = {}
        if info.get('handle'):
            lookup_kwargs['handle'] = info['handle']
        elif info.get('channel_id'):
            lookup_kwargs['channel_id'] = info['channel_id']
        else:
            lookup_kwargs['name'] = info['name']

        channel_obj, created = YouTubeChannel.objects.get_or_create(
            **lookup_kwargs,
            defaults={
                'name': info['name'],
                'handle': info.get('handle') or f"@{info['name'].replace(' ', '')}",
                'channel_id': info.get('channel_id'),
                'custom_url': info.get('custom_url'),
                'avatar_url': info.get('avatar_url', ''),
                'description': info.get('description', ''),
                'subscriber_count': info.get('subscriber_count', '')
            }
        )

        if not created:
            channel_obj.name = info['name']
            if info.get('avatar_url'):
                channel_obj.avatar_url = info['avatar_url']
            if info.get('subscriber_count'):
                channel_obj.subscriber_count = info['subscriber_count']
            if info.get('description'):
                channel_obj.description = info['description']
            channel_obj.save()

        # 2. Save long-form videos linked to this channel (Zero Shorts)
        imported_count = 0
        for v in videos:
            # Guarantee no shorts can slip in
            if is_short_video(title=v['title'], duration_str=v['duration_str']):
                shorts_count += 1
                continue

            vid_obj, v_created = CuratedVideo.objects.update_or_create(
                youtube_id=v['youtube_id'],
                defaults={
                    'channel_ref': channel_obj,
                    'title': v['title'],
                    'channel': channel_obj.name,
                    'duration_str': v['duration_str'],
                    'duration_minutes': v['duration_minutes'],
                    'category': v.get('category', 'YouTube'),
                    'thumbnail_url': v.get('thumbnail_url', ''),
                    'description': v.get('description', '')
                }
            )
            imported_count += 1

        # Update total long-form videos on channel
        channel_obj.video_count = channel_obj.videos.count()
        channel_obj.save()

        return {
            'status': 'ok',
            'channel': {
                'id': channel_obj.id,
                'name': channel_obj.name,
                'handle': channel_obj.handle,
                'custom_url': channel_obj.custom_url,
                'avatar_url': channel_obj.avatar_url,
                'subscriber_count': channel_obj.subscriber_count,
                'description': channel_obj.description,
                'video_count': channel_obj.video_count
            },
            'imported_count': imported_count,
            'shorts_excluded': shorts_count,
            'message': f"Successfully added channel '{channel_obj.name}' with {imported_count} long-form videos. Strictly quarantined {shorts_count} Shorts."
        }
