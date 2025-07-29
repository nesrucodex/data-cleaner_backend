import cron from "node-cron";
import axios from "axios";

export function startHealthCheckCron(url: string, shouldStart: boolean) {
  if (!shouldStart) {
    console.log("Health check cron is disabled by flag.");
    return null; // no cron job started
  }

  return cron.schedule("*/10 * * * *", async () => {
    try {
      const response = await axios.get(url);
      console.log(
        `[${new Date().toISOString()}] Health check success:`,
        response.status
      );
    } catch (error: any) {
      console.warn(
        `[${new Date().toISOString()}] Health check failed:`,
        error.message
      );
    }
  });
}
