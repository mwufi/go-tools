import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily("forget old misses", { hourUTC: 9, minuteUTC: 17 }, internal.activity.purge, {});
export default crons;
