# LDDSE Protocol Calculator

Low Dose Dobutamine Stress Echo — Aortic Stenosis Assessment Tool

## Deploy to Vercel (free)

1. Create a free account at https://github.com and https://vercel.com
2. Create a new GitHub repository called `lddse`
3. Upload all files from this folder to that repository
4. Go to vercel.com → New Project → Import your GitHub repo
5. Vercel auto-detects Vite — just click Deploy
6. You get a live URL like https://lddse.vercel.app

## Add to iPhone Home Screen

1. Open your Vercel URL in Safari (must be Safari)
2. Tap the Share button (box with arrow at bottom)
3. Tap "Add to Home Screen"
4. Name it "LDDSE" → tap Add
5. It launches full-screen like a native app

## Local development

```bash
npm install
npm run dev
```

## Notes
- Session data persists in localStorage for 8 hours
- Tapping Reset clears the saved session
- Export/Print opens a formatted report in a new tab with a Print button
