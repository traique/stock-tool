import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  const { data } = await supabase
    .from('prices')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(20)

  res.status(200).json(data)
}
