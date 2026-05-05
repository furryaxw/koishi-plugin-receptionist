import {Context, h, Schema, Session} from 'koishi'

export const name = 'receptionist'

export interface Config {
    isAt: boolean
}

export const usage = `
当群员加入时发送欢迎消息
`

export const Config: Schema<Config> = Schema.object({
    isAt: Schema.boolean().default(true).description("at新进群的")
})

declare module "koishi" {
    interface Tables {
        "receptionist-data": WelcomeDB;
    }
}

export interface WelcomeDB {
    id: string;
    words: string;
}

export function apply(ctx: Context, config: Config) {
    ctx.model.extend("receptionist-data", {
        id: "string",
        words: "text"
    })

    const timeInterval: Record<string, NodeJS.Timeout | null> = {};

    const cmd = ctx.command("欢迎词", {authority: 1})
        .action(async ({session}) => {
            const group = session?.guildId || session?.channelId;
            if (!session?.guildId || !session?.userId) return '该指令只能在群组中使用。';

            const dbResult = await ctx.database.get("receptionist-data", {id: group});
            if (dbResult.length === 0) return;

            const words = dbResult[0].words;
            const result = words.split(/\r?\n/).map(word => h('p', word));

            return h('message', result);
        })

    cmd.subcommand(".设定", {authority: 1})
        .action(async ({session}) => {
            const group = session?.guildId || session?.channelId;
            if (!session?.guildId || !session?.userId) return '该指令只能在群组中使用。';
            if (!await isUserAdmin(session, session.userId)) return '权限不足'

            await session.send(`正在为 ${group} 设定欢迎词, 请发送`);
            const words = await session.prompt();

            if (!words) return "设定已取消或超时。";

            const existing = await ctx.database.get("receptionist-data", {id: group});

            if (existing.length > 0) {
                await ctx.database.set("receptionist-data", {id: group}, {words});
            } else {
                await ctx.database.create("receptionist-data", {id: group, words});
            }

            return h('message', [
                h('p', '已设定欢迎词'),
                h('p', words)
            ]);
        })

    cmd.subcommand(".删除", {authority: 1})
        .action(async ({session}) => {
            const group = session?.guildId || session?.channelId;
            if (!session?.guildId || !session?.userId) return '该指令只能在群组中使用。';
            if (!await isUserAdmin(session, session.userId)) return '权限不足'

            await ctx.database.remove("receptionist-data", {id: group});
            return h('message', [h('p', '已删除本群欢迎词')]);
        })

    ctx.on("guild-member-added", async (session) => {
        const cacheKey = session.platform + session.guildId;

        // 简单的防抖/节流逻辑
        if (timeInterval[cacheKey] === null) return;
        timeInterval[cacheKey] = null;

        setTimeout(() => {
            delete timeInterval[cacheKey];
        }, 1000 * 30);

        const group = session.guildId || session.channelId;
        if (!group) return;

        const dbResult = await ctx.database.get("receptionist-data", {id: group});
        if (dbResult.length === 0) return;

        const words = dbResult[0].words;
        const result: h[] = [];

        if (config.isAt) {
            result.push(h.at(session.userId));
        }

        for (const word of words.split(/\r?\n/)) {
            result.push(h('p', word));
        }

        await session.send(h('message', result));
    })
}

async function isUserAdmin(session: Session, userId: string): Promise<boolean> {
    if (!session.guildId) return false;

    // 使用 (session.user as any) 来规避类型检查，同时保留可选链以防 user 为空
    if ((session.user as any)?.authority >= 3) return true;

    try {
        const memberInfo = await session.bot.getGuildMember(session.guildId, userId);
        if (!memberInfo) return false;

        const adminRoles = ["owner", "admin", "administrator"];
        const memberRoles = (memberInfo.roles || []).map(r => r.name).filter((n): n is string => !!n);

        for (const role of memberRoles) {
            if (adminRoles.includes(role.toLowerCase())) return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}