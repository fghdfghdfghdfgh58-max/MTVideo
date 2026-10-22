# MTVideo: persistent video uploads with Cloudflare R2

This build stores video bytes in Cloudflare R2 and keeps video metadata in Supabase PostgreSQL. Render's local filesystem is not used for new video uploads when R2 is configured.

## 1. Create an R2 bucket

1. Open https://dash.cloudflare.com/ and select **R2 Object Storage**.
2. Create a bucket, for example `mtvideo-videos`.
3. In R2, open **Manage R2 API Tokens** and create a token with **Object Read & Write** permission scoped to this bucket.
4. Copy the Access Key ID and Secret Access Key once. Do not share them publicly.
5. Your account ID is available in the Cloudflare dashboard. The S3 endpoint format is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

## 2. Add these environment variables to the Render web service

- `R2_ACCOUNT_ID` = Cloudflare account ID
- `R2_ACCESS_KEY_ID` = R2 token Access Key ID
- `R2_SECRET_ACCESS_KEY` = R2 token Secret Access Key
- `R2_BUCKET_NAME` = exact bucket name, e.g. `mtvideo-videos`
- `DATABASE_URL` = the Supabase Session Pooler PostgreSQL connection string already configured

Keep all values private. Do not put R2 credentials in frontend HTML or commit them to GitHub.

## 3. Deploy

Replace `server.js` and `package.json` in the existing GitHub repo with these files, commit and push to the branch connected to Render. Render should install the new dependencies during deploy. If not, trigger **Manual Deploy → Deploy latest commit**.

## 4. Test

After deploy, create a test channel and upload a small MP4. Play it, refresh, then check that it still plays. R2 is used by the existing `/media/<file-key>` endpoint, including HTTP range requests for video seeking. Deleting a video also deletes its R2 object.

## Notes

- This changes storage for new uploads only. Existing videos in Render's old local `data/uploads` folder are not automatically transferred. They must be copied to R2 and their `videos.file` keys verified.
- Existing database records and videos are not automatically restored by this change.
- The server intentionally returns HTTP 503 for uploads if R2 is not configured, instead of silently saving them to Render's ephemeral filesystem.
- Keep the old deployment/repository revision available until account, login, upload, playback, and delete tests pass.
