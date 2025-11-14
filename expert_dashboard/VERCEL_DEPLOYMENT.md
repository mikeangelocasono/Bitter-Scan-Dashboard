# Vercel Deployment Guide

## Issue Fixed: lightningcss Native Module Error

The build error `Cannot find module '../lightningcss.linux-x64-gnu.node'` has been resolved by:

1. **Explicitly adding lightningcss dependencies** in `package.json`:
   - `lightningcss` as a devDependency
   - `lightningcss-linux-x64-gnu` as a devDependency (required for Vercel's Linux build environment)
   - All platform-specific binaries as optionalDependencies

2. **Updated Next.js configuration** (`next.config.ts`):
   - Added `serverComponentsExternalPackages` to properly handle lightningcss native modules

3. **Created `.npmrc`** to ensure optional dependencies are installed

## Project Structure

```
expert_dashboard/
├── src/
│   └── app/          # Next.js App Router (pages directory)
│       ├── layout.tsx
│       ├── page.tsx
│       ├── dashboard/
│       ├── login/
│       └── ...
├── package.json       # Updated with lightningcss dependencies
├── next.config.ts     # Updated for native module handling
├── tsconfig.json      # TypeScript configuration
├── postcss.config.mjs # Tailwind CSS v4 PostCSS config
└── .npmrc            # npm configuration for native modules
```

## Pre-Deployment Steps

### 1. Clean and Reinstall Dependencies

```bash
# Navigate to project directory
cd expert_dashboard

# Remove node_modules and lock file
rm -rf node_modules package-lock.json

# Clean npm cache (optional but recommended)
npm cache clean --force

# Install dependencies fresh
npm install
```

### 2. Test Build Locally

```bash
# Test the production build
npm run build

# If build succeeds, test the production server
npm run start
```

### 3. Verify Dependencies

Ensure these packages are installed:
- `lightningcss` (^1.27.0)
- `lightningcss-linux-x64-gnu` (^1.27.0)
- `tailwindcss` (^4)
- `@tailwindcss/postcss` (^4)

## Vercel Deployment

### Option 1: Deploy via Vercel CLI

```bash
# Install Vercel CLI globally (if not already installed)
npm i -g vercel

# Login to Vercel
vercel login

# Deploy (from expert_dashboard directory)
vercel

# For production deployment
vercel --prod
```

### Option 2: Deploy via Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Import your Git repository
3. Configure project:
   - **Framework Preset**: Next.js
   - **Root Directory**: `expert_dashboard` (if repo root is BitterScan)
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next` (auto-detected)
   - **Install Command**: `npm install`

### Option 3: GitHub Integration

1. Connect your GitHub repository to Vercel
2. Set **Root Directory** to `expert_dashboard` if needed
3. Vercel will auto-detect Next.js and use the correct build settings

## Environment Variables

If your project uses environment variables (e.g., Supabase), add them in Vercel Dashboard:

1. Go to Project Settings → Environment Variables
2. Add required variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - Any other environment variables your app needs

## Build Configuration

The project is configured with:

- **Framework**: Next.js 15.4.6
- **Node Version**: 20.x (recommended, set in Vercel if needed)
- **Build Command**: `npm run build`
- **Output Directory**: `.next` (auto-detected by Vercel)

## Troubleshooting

### If build still fails with lightningcss error:

1. **Check Node version**: Ensure Vercel uses Node.js 20.x
   - In Vercel Dashboard: Settings → General → Node.js Version

2. **Force reinstall**: Add to Vercel build settings:
   ```bash
   npm ci --force
   ```

3. **Clear Vercel build cache**: 
   - In Vercel Dashboard: Settings → General → Clear Build Cache

4. **Verify package.json**: Ensure `lightningcss-linux-x64-gnu` is in `devDependencies`

### If you see other errors:

- **TypeScript errors**: Run `npm run lint` locally first
- **Missing dependencies**: Check `package.json` includes all required packages
- **Build timeout**: Increase build timeout in Vercel settings if needed

## Post-Deployment

After successful deployment:

1. Verify the site loads correctly
2. Test all routes (login, dashboard, etc.)
3. Check browser console for any runtime errors
4. Monitor Vercel logs for any issues

## Additional Notes

- The project uses **Tailwind CSS v4** with the new `@import "tailwindcss"` syntax
- **Next.js App Router** is used (not Pages Router)
- All components are in `src/app/` and `src/components/`
- TypeScript is configured with path aliases (`@/*` → `./src/*`)

