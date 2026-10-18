# Supabase setup (sign-in with GitHub)

Sign-in only adds saved chats and saved paid evidence. The app works without it.

1. Create a Supabase project.
2. Open the SQL editor and run `supabase/migrations/001_init.sql` once. It creates three tables with Row Level Security (each user reads and writes only their own rows).
3. Authentication, Providers: enable GitHub (OAuth client ID and secret). Add the redirect URL that Supabase shows to GitHub. Under URL Configuration, add `<your site>/auth/callback` to the allowed redirect URLs.
4. Put the project URL and the anon key in `frontend/.env` and in the Vercel project settings:
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both are public by design. Never use the service-role key in this app.
5. With the two public values set, the agent chat and the command route need a signed-in user. `AUTH_REQUIRED=false` turns that off for local work. Fact sheets, the feed and `/api/check` stay public.

Counts of signed-in users and saved chats are visible in the Supabase dashboard (Authentication, Table editor). Nothing public is added.
