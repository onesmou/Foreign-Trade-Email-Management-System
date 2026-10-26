export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { scheduleProcessing } = await import("./lib/knowledge");
    scheduleProcessing();
    const { resumeWhatsApp } = await import("./lib/whatsapp");
    void resumeWhatsApp();
    const { startProgressWorker } = await import("./lib/progress");
    startProgressWorker();
    const { startBackupScheduler } = await import("./lib/backup-schedule");
    startBackupScheduler();
  }
}
