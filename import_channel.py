#!/usr/bin/env python
"""
FocusLoop Backend Channel Ingestion Program
Run this program to import any YouTube channel while strictly stripping all Shorts.

Examples:
    python import_channel.py @veritasium
    python import_channel.py @3blue1brown @DonkeyTube @kurzgesagt
    python import_channel.py --file channels.txt
"""
import os
import sys
import django

# Setup Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'focusguard.settings')
django.setup()

from django.core.management import call_command

if __name__ == '__main__':
    args = sys.argv[1:]
    if not args:
        print("Usage: python import_channel.py <@handle or URL or channel_name> [--file channels.txt]")
        print("Example: python import_channel.py @veritasium @3blue1brown")
        sys.exit(0)

    call_command('import_channel', *args)
