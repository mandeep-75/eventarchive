// Creates a teacher login and its profile row.
//
// Why an edge function instead of calling supabase.auth.signUp from the app:
// signUp establishes a session for the new account, which would sign the
// manager straight out of the app mid-provision. The obvious workaround —
// shipping a service-role key to the browser and calling auth.admin.createUser
// — would hand every visitor full admin access to the project, so the key lives
// here instead.
//
// Deploy:  supabase functions deploy create-teacher
// Then set the function's "Verify JWT" setting to ON (the default), which is
// what lets the function trust the caller's Authorization header.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceKey) return json({ error: 'Server misconfigured' }, 500)

  // The caller's own client, built from their token, so this check runs under
  // the caller's identity and honours the profiles RLS policies.
  const authHeader = req.headers.get('Authorization') ?? ''
  const caller = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceKey,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: userData, error: userError } = await caller.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Not signed in' }, 401)

  const { data: profile } = await caller
    .from('profiles')
    .select('is_manager')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (!profile?.is_manager) {
    return json({ error: 'Only a manager can create accounts' }, 403)
  }

  let body: { email?: string; password?: string; name?: string; departmentId?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const email = body.email?.trim()
  const name = body.name?.trim()
  const password = body.password ?? ''
  const departmentId = body.departmentId

  if (!email || !name || !departmentId) {
    return json({ error: 'Name, email and department are all required' }, 400)
  }
  if (password.length < 6) {
    return json({ error: 'Password must be at least 6 characters' }, 400)
  }

  // Service-role client, for the privileged write.
  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !created.user) {
    return json({ error: createError?.message ?? 'Could not create the login' }, 400)
  }

  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    name,
    email,
    role: 'teacher',
    department_id: departmentId,
    is_manager: false,
  })

  if (profileError) {
    // Do not leave an orphan login behind that nobody can sign in to, and that
    // would show up in the teacher list with no profile behind it.
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: `Could not create the profile: ${profileError.message}` }, 400)
  }

  return json({ uid: created.user.id, email })
})
