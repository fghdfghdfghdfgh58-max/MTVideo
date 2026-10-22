# MTVideo Supabase migration

This version uses Supabase PostgreSQL via `DATABASE_URL` instead of the local SQLite database. Set `DATABASE_URL` in Render to your Supabase PostgreSQL connection string (keep it secret). If Render cannot connect to Supabase's direct endpoint due to IPv4/IPv6 compatibility, use the Supabase Session Pooler connection string.

## Before deploying

1. Back up the existing SQLite database and uploaded files if you still have them.
2. Ensure the Supabase public tables and columns match the server's expected schema:
   - users(id,email,salt,hash,ts)
   - sessions(token,user_id,ts)
   - channels(id,name,owner,ts)
   - videos(id,title,type,ch_id,owner,file,dur,ts)
   - reacts(video_id,user_id,val)
   - comments(id,video_id,user_id,name,text,ts)
   - subs(channel_id,user_id)
   - live(user_id,title,ch_id,ts)
   - chat(id,live_id,name,text,ts)
3. Run `supabase-compatibility.sql` in Supabase SQL Editor if `reacts` has `value` instead of `val`.
4. Deploy to Render and check Logs.

## Important limitation

This migration moves database operations to PostgreSQL, but uploaded video bytes still go to `DATA_DIR/uploads` (or the app-local `data/uploads` directory). Render's free filesystem is ephemeral. Videos will still disappear across instance replacement/redeploy until uploads are migrated to persistent object storage such as Cloudflare R2. This ZIP does not import old SQLite rows or old video files automatically.
