import { Events } from "discord.js";
import { logger, startupLog } from "../utils/logger.js";
import config from "../config/application.js";
import { reconcileReactionRoleMessages } from "../services/reactionRoleService.js";
import {
  reconcileTicketPanels,
  reconcileVerificationPanels,
  reconcileReactionRolePanelHealth,
} from "../services/panelHealthService.js";
import { reconcileLevelRoles } from "../services/levelRoleSyncService.js";

// Bật/Tắt gửi thông báo khi bot khởi động
const ENABLE_STARTUP_ANNOUNCEMENT = true;

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      client.user.setPresence(config.bot.presence);

      startupLog(`Ready! Logged in as ${client.user.tag}`);
      startupLog(`Serving ${client.guilds.cache.size} guild(s)`);
      startupLog(`Loaded ${client.commands.size} commands`);

      // Gửi thông báo khi bot khởi động (nếu được bật)
      if (ENABLE_STARTUP_ANNOUNCEMENT) {
        try {
          const channel = await client.channels.fetch("1521007503263928341");

          if (channel?.isTextBased()) {
            await channel.send(`# 🚫 Kênh Lọc Spam
Mọi tin nhắn gửi trong kênh này sẽ tự động bị xóa và người gửi sẽ bị hạn chế trong vòng 1 ngày. Nếu bạn cho rằng đây là nhầm lẫn, vui lòng liên hệ Admin để được hỗ trợ xử lý. Trong trường hợp cố tình vi phạm, hệ thống sẽ ghi nhận cảnh cáo. Nếu tái phạm đến lần thứ 3, tài khoản sẽ bị __**cấm vĩnh viễn**__ khỏi máy chủ mà không cần thông báo trước.`);

            startupLog("Startup announcement sent successfully.");
          } else {
            logger.warn("Startup announcement channel is not a text channel.");
          }
        } catch (error) {
          logger.error("Failed to send startup announcement:", error);
        }
      }

      const reconciliationSummary = await reconcileReactionRoleMessages(client);
      startupLog(
        `Reaction role reconciliation: scanned ${reconciliationSummary.scannedMessages}, removed ${reconciliationSummary.removedMessages}, errors ${reconciliationSummary.errors}`
      );

      const ticketPanelSummary = await reconcileTicketPanels(client);
      startupLog(
        `Ticket panel health: scanned ${ticketPanelSummary.scannedGuilds} guilds, healthy ${ticketPanelSummary.healthyPanels}, deleted ${ticketPanelSummary.deletedPanels}, missing channel ${ticketPanelSummary.missingChannels}, recovered ${ticketPanelSummary.recoveredIds}, errors ${ticketPanelSummary.errors}`
      );

      const verificationPanelSummary = await reconcileVerificationPanels(client);
      startupLog(
        `Verification panel health: scanned ${verificationPanelSummary.scannedGuilds} guilds, healthy ${verificationPanelSummary.healthyPanels}, deleted ${verificationPanelSummary.deletedPanels}, missing channel ${verificationPanelSummary.missingChannels}, recovered ${verificationPanelSummary.recoveredIds}, errors ${verificationPanelSummary.errors}`
      );

      const reactionRolePanelSummary =
        await reconcileReactionRolePanelHealth(client);

      startupLog(
        `Reaction role panel health: scanned ${reactionRolePanelSummary.scannedPanels} panels, healthy ${reactionRolePanelSummary.healthyPanels}, deleted ${reactionRolePanelSummary.deletedPanels}, missing channel ${reactionRolePanelSummary.missingChannels}, recovered ${reactionRolePanelSummary.recoveredIds}, errors ${reactionRolePanelSummary.errors}`
      );

      const levelRoleSummary = await reconcileLevelRoles(client);

      startupLog(
        `Level role sync: scanned ${levelRoleSummary.scannedGuilds} guilds, pruned ${levelRoleSummary.prunedRewardEntries} stale rewards, re-awarded ${levelRoleSummary.rolesReAwarded} roles, errors ${levelRoleSummary.errors}`
      );
    } catch (error) {
      logger.error("Error in ready event:", error);
    }
  },
};
