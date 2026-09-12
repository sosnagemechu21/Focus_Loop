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

# If running on Vercel, ensure migrations are run
if os.environ.get('VERCEL'):
    try:
        from django.core.management import call_command
        call_command('migrate', interactive=False)
        from core.models import FocusState
        FocusState.get_current()
    except Exception as e:
        print(f"Vercel DB init notice: {e}")
