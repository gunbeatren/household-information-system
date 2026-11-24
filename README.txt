HOUSEHOLD INFORMATION SYSTEM - OFFLINE WEB APP

This is a progressive web app (PWA) that can be installed on Android from Chrome. It stores resident data in the browser's IndexedDB database on the device.


INSTALL ON ANDROID
1. Extract the ZIP to a computer or host the folder on an HTTPS website (PWA install/service worker requires HTTPS or localhost).
2. Open the app URL in Chrome on your Android phone.
3. Tap Chrome menu (three dots) > Install app or Add to Home screen.
4. Launch from the home screen.

For local preview, run a static HTTP server from this folder (for example: python -m http.server 8000) and open http://localhost:8000.

FEATURES
- CRUD resident profiles
- Personal, location, household, family, education, employment fields
- Household grouping by Household ID
- Dashboard counts and demographics
- Resident search and filters
- JSON backup and restore; CSV import/export
- Offline caching after first visit
- Optional PIN screen (interface lock only; does not encrypt the underlying database)

IMPORTANT LIMITATIONS
- This is a PWA and not a native APK. Android's installable app experience requires hosting over HTTPS or a localhost development server. This source package does not include a compiled APK.
- Data stays in this browser profile. Browser clearing/storage cleanup may delete it. Back up regularly.
- PIN is a convenience lock, not encryption. For real resident personal information, use a secure native implementation with database encryption, proper authentication, and secure backup controls before production deployment.
