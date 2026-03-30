import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { target } = req.body || {};

    if (!["stocks", "gold", "fuel", "all"].includes(target)) {
      return res.status(400).json({ error: "Target không hợp lệ" });
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
          message: "Đã tạo lệnh chạy",
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
      return res.status(500).json({
        error: "Thiếu cấu hình GitHub env",
        debug: {
          hasOwner: !!owner,
          hasRepo: !!repo,
          hasWorkflowToken: !!token,
          workflow,
          ref,
        },
      });
    }

    const ghUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;

    const ghRes = await fetch(ghUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref,
        inputs: {
          target,
          job_run_id: String(inserted.id),
        },
      }),
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
        debug: {
          url: ghUrl,
          workflow,
          ref,
          owner,
          repo,
        },
      });
    }

    await supabase
      .from("job_runs")
      .update({
        status: "running",
        progress: 10,
        message: "Đã gửi lệnh sang GitHub Actions",
      })
      .eq("id", inserted.id);

    return res.status(200).json({
      ok: true,
      job_run_id: inserted.id,
      github_status: ghRes.status,
      github_response: ghText || "accepted",
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Unknown server error",
    });
  }
}
