// URL recipes the LLM may use for queries no shortcut covers. Keep these short:
// they go into every prompt. Add more as the team finds useful ones.
export const RECIPES = `
GitHub (use {me.github} for "my"/"me"; {team.github_org} for "our"):
- PRs I opened: https://github.com/pulls?q=is:open+is:pr+author:{me.github}
- PRs waiting on my review: https://github.com/pulls?q=is:open+is:pr+review-requested:{me.github}
- Issues assigned to me: https://github.com/issues?q=is:open+assignee:{me.github}
- Search code in org: https://github.com/search?q=org:{team.github_org}+<terms>&type=code
- Repo: https://github.com/<owner>/<repo>, its PRs /pulls, issues /issues, actions /actions
- Notifications: https://github.com/notifications
Linear: https://linear.app/{team.linear}/my-issues/assigned , search https://linear.app/{team.linear}/search?q=<terms>
Google Calendar: today https://calendar.google.com/calendar/r/day , week /r/week , new event https://calendar.google.com/calendar/r/eventedit?text=<title>
Gmail: search https://mail.google.com/mail/u/0/#search/<terms> , unread https://mail.google.com/mail/u/0/#search/is%3Aunread
Google Drive search: https://drive.google.com/drive/search?q=<terms>
Maps directions: https://www.google.com/maps/dir/?api=1&destination=<place>
YouTube search: https://www.youtube.com/results?search_query=<terms>
Wikipedia: https://en.wikipedia.org/wiki/Special:Search?search=<terms>
npm package: https://www.npmjs.com/package/<name>
Weather: https://www.google.com/search?q=weather+<place>
Convex dashboard: https://dashboard.convex.dev
`.trim();
