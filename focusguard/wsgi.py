"""
WSGI config for focusguard project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'focusguard.settings')

application = get_wsgi_application()
app = application

# If running on Vercel with SQLite in /tmp, ensure migrations are run
if os.environ.get('VERCEL') and not os.environ.get('DATABASE_URL'):
    try:
        from django.core.management import call_command
        call_command('migrate', interactive=False)
        from core.models import FocusState
        FocusState.get_current()
        from core.views import _seed_curated_videos, _seed_mock_history
        _seed_curated_videos()
        _seed_mock_history()
    except Exception as e:
        print(f"Vercel SQLite init notice: {e}")
