import { createClient } from "@supabase/supabase-js";

function normalizeTarget(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "stock" || v === "stocks") return "stocks";
  if (v === "gold") return "gold";
  if (v === "fuel" || v === "gas") return "fuel";
  if (v === "all") return "all";
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawTarget = req.body?.target;
    const target = normalizeTarget(rawTarget);

    if (!target) {
      return res.status(400).json({
        error: "Target không hợp lệ",
        rawTarget,
      });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: inserted, error: insertError } = await supabase
      .from("job_runs")
      .insert([
        {
          job_name: "manual_update",
          target,
          status: "queued",
          progress: 5,
          message: `Đã tạo lệnh chạy cho ${target}`,
          source: "manual",
          started_at: new Date().toISOString(),
        },
      ])
      .select("*")
      .single();

    if (insertError) {
      return res.status(500).json({
        error: "Insert job_runs thất bại",
        detail: insertError.message,
      });
    }

    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    const workflow = process.env.GITHUB_WORKFLOW_FILE || "manual-update.yml";
    const ref = process.env.GITHUB_REF || "main";
    const token = process.env.GITHUB_WORKFLOW_TOKEN;

    if (!owner || !repo || !token) {
      await supabase
        .from("job_runs")
        .update({
          status: "failed",
          progress: 100,
          message: "Thiếu cấu hình GitHub env",
          error_text: JSON.stringify({
            hasOwner: !!owner,
            hasRepo: !!repo,
            hasToken: !!token,
            workflow,
            ref,
          }),
          finished_at: new Date().toISOString(),
        })
        .eq("id", inserted.id);

      return res.status(500).json({
        error: "Thiếu cấu hình GitHub env",
      });
    }

    const ghUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;

    const payload = {
      ref,
      inputs: {
        target,
        job_run_id: String(inserted.id),
      },
    };

    const ghRes = await fetch(ghUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const ghText = await ghRes.text();

    if (!ghRes.ok) {
      await supabase
        .from("job_runs")
        .update({
          status: "failed",
          progress: 100,
          message: "Gọi GitHub Actions thất bại",
          error_text: ghText,
          finished_at: new Date().toISOString(),
        })
        .eq("id", inserted.id);

      return res.status(500).json({
        error: "Không dispatch được workflow",
        github_status: ghRes.status,
        github_response: ghText,
        payload,
      });
    }

    await supabase
      .from("job_runs")
      .update({
        status: "running",
        progress: 10,
        message: `Đã gửi lệnh ${target} sang GitHub Actions`,
        error_text: JSON.stringify(payload),
      })
      .eq("id", inserted.id);

    return res.status(200).json({
      ok: true,
      job_run_id: inserted.id,
      payload,
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
    });
  }
}
