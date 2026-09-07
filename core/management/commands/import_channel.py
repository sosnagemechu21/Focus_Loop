import os
from django.core.management.base import BaseCommand
from core.youtube_service import YouTubeService


class Command(BaseCommand):
    help = "Import any YouTube channel by handle, URL, or name, strictly excluding all Shorts"

    def add_arguments(self, parser):
        parser.add_argument(
            'channels',
            nargs='*',
            type=str,
            help="One or more channel handles (e.g. @veritasium), URLs, or names"
        )
        parser.add_argument(
            '--file',
            type=str,
            help="Path to a text file containing channel identifiers (one per line)"
        )
        parser.add_argument(
            '--max-videos',
            type=int,
            default=40,
            help="Maximum long-form videos to ingest per channel (default: 40)"
        )

    def handle(self, *args, **options):
        channels_to_import = list(options['channels'])
        file_path = options.get('file')
        max_videos = options['max_videos']

        if file_path:
            if not os.path.exists(file_path):
                self.stderr.write(self.style.ERROR(f"File not found: {file_path}"))
                return
            with open(file_path, 'r', encoding='utf-8') as f:
                for line in f:
                    stripped = line.strip()
                    if stripped and not stripped.startswith('#'):
                        channels_to_import.append(stripped)

        if not channels_to_import:
            self.stdout.write(self.style.WARNING(
                "No channels provided. Specify channels as arguments or use --file <path>.\n"
                "Example: python manage.py import_channel veritasium 3blue1brown DonkeyTube\n"
                "         python manage.py import_channel \"@veritasium\""
            ))
            return

        self.stdout.write(self.style.MIGRATE_HEADING(
            f"\n=== FocusLoop: Starting backend ingestion for {len(channels_to_import)} channel(s) ===\n"
            f"    Shorts Quarantine Policy: STRICT (100% of Shorts/reels will be rejected)\n"
        ))

        total_imported_all = 0
        total_shorts_excluded_all = 0

        for raw_id in channels_to_import:
            identifier = raw_id.strip()
            self.stdout.write(f"[*] Ingesting channel: {self.style.NOTICE(identifier)} ...")
            res = YouTubeService.ingest_channel(identifier, max_videos=max_videos)

            if res.get('status') == 'ok':
                chan = res['channel']
                imported = res['imported_count']
                shorts = res['shorts_excluded']
                total_imported_all += imported
                total_shorts_excluded_all += shorts

                self.stdout.write(self.style.SUCCESS(
                    f"    [+] Channel Added: {chan['name']} ({chan['handle'] or 'Verified'})\n"
                    f"        - Long-Form Videos Ingested: {imported}\n"
                    f"        - YouTube Shorts Quarantined: {shorts} (Filtered out)\n"
                    f"        - Total Long-Form Library for Creator: {chan['video_count']} videos\n"
                ))
            else:
                self.stdout.write(self.style.ERROR(
                    f"    [-] Failed to ingest '{identifier}': {res.get('message', 'Unknown error')}\n"
                ))

        self.stdout.write(self.style.SUCCESS(
            f"=== Ingestion Batch Complete ===\n"
            f"    Total Long-Form Videos Added: {total_imported_all}\n"
            f"    Total Shorts Quarantined: {total_shorts_excluded_all}\n"
        ))

