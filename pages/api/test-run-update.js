export default async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    hint: "Dùng POST /api/run-update với body { target: 'gold' }",
  });
}
