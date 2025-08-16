# Dotypos API Setup Guide

## Your Credentials (From Dotypos)
```
Client ID: deskohub
Client Secret: KXUjm8zjoF8Vjg0G03mo
Test License Key: HWKDKABK
```

## Setup Instructions

### Step 1: Access the Setup Page
1. Open your browser and go to: http://localhost:3000/en-US/admin/dotypos-setup
   (or http://localhost:3000/cs-CZ/admin/dotypos-setup for Czech)

### Step 2: Enter Credentials
1. Enter the Client ID: `deskohub`
2. Enter the Client Secret: `KXUjm8zjoF8Vjg0G03mo`
3. The redirect URI should be auto-filled with the current page URL
4. Click "Generate Authorization URL"

### Step 3: Authorize with Dotypos
1. Click "Go to Dotypos Authorization Page"
2. You'll be redirected to Dotypos login page
3. Log in with your Dotypos account (or create a test account using the license key HWKDKABK)
4. Grant access to the application
5. You'll be redirected back to the setup page with tokens

### Step 4: Save Configuration
1. Once redirected back, you'll see your Refresh Token and Cloud ID
2. Copy the entire `.env.local` configuration shown on the page
3. Add it to your `/Users/c_fkalny/Developer/deskohub-site/.env.local` file
4. Save the file

### Step 5: Test the Connection
1. Restart the development server (Ctrl+C and `bun run dev`)
2. Visit: http://localhost:3000/api/dotypos/test
3. You should see a success response with cloud information

## Important Notes

- **Security**: Never commit the `.env.local` file to version control
- **Refresh Token**: This token doesn't expire but can be revoked from Dotypos admin
- **Access Token**: Automatically managed by the auth service (1-hour expiry)
- **Test License**: Use HWKDKABK to create a test Dotypos account if needed

## Creating a Test Account (Optional)
If you don't have a Dotypos account:
1. Download the Dotykačka application
2. Use the test license key: HWKDKABK
3. Follow the setup guide at: https://manual.dotypos.com

## Troubleshooting

### "Not configured" error
- Ensure all environment variables are set in `.env.local`
- Restart the development server after adding variables

### "Connection failed" error
- Check that the refresh token is valid
- Verify the Cloud ID matches your Dotypos account
- Ensure you have internet connection

### After successful setup
- Delete the `/admin/dotypos-setup` page (it's only for one-time setup)
- The backend will use the stored refresh token for all API calls
- No user interaction needed for normal operation

## API Documentation
Full Dotypos API documentation: https://docs.api.dotypos.com/