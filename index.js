const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const { analyzeResume, setJobRequirements } = require('./resumeParser');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
let waitingForJobReqs = false;

// Очередь и хранилище для пакетной обработки
let processingQueue = Promise.resolve();
let batchResults = [];
let batchTimeout = null;
let currentChatCtx = null;
let isAnalysisStarted = false; // флаг, чтобы отправлять уведомление 1 раз на всю пачку

bot.start((ctx) => {
    ctx.reply(
        '👋 Вітаю! Я ваш незалежний AI HR-асистент.\n\n' +
        'Оберіть дію:',
        Markup.keyboard([
            ['📝 Задати/Змінити вимоги вакансії'],
            ['ℹ️ Як мене використовувати']
        ]).resize()
    );
});

bot.hears('📝 Задати/Змінити вимоги вакансії', (ctx) => {
    waitingForJobReqs = true;
    ctx.reply('✍️ Надішліть текстом опис вакансії та вимоги:');
});

bot.hears('ℹ️ Як мене використовувати', (ctx) => {
    ctx.reply('📌 Опишіть вакансію кнопкою вище, а потім надішліть PDF-резюме.');
});

bot.on('text', (ctx) => {
    if (waitingForJobReqs) {
        setJobRequirements(ctx.message.text);
        waitingForJobReqs = false;
        return ctx.reply('✅ Вимоги оновлено! Чекаю на PDF-резюме.');
    }
    ctx.reply('Скористайтеся кнопками або надішліть PDF.');
});

// ОБРОБКА PDF З ПАКЕТНИМ ВИХОДОМ В КІНЦІ
bot.on('document', async (ctx) => {
    const document = ctx.message.document;

    if (document.mime_type !== 'application/pdf') {
        return ctx.reply('⚠️ Будь ласка, надсилайте файли виключно у форматі PDF.');
    }

    currentChatCtx = ctx;

    // Якщо це перший файл у пачці — відправляємо повідомлення про початок аналізу
    if (!isAnalysisStarted) {
        isAnalysisStarted = true;
        await ctx.reply('⏳ **Йде аналіз резюме, зачекайте...** Бот обробляє отримані файли.', { parse_mode: 'Markdown' });
    }

    // Скидаємо попередній таймер збору пачки, поки летять нові файли
    if (batchTimeout) {
        clearTimeout(batchTimeout);
    }

    // Додаємо файл в чергу обробки
    processingQueue = processingQueue.then(async () => {
        let tempPath;
        try {
            // 1. Отримуємо файл від Telegram
            const fileId = document.file_id;
            const fileInfoRes = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
            const fileInfo = await fileInfoRes.json();

            if (!fileInfo.ok) {
                throw new Error("Не вдалося отримати файл від Telegram");
            }

            const filePath = fileInfo.result.file_path;
            const downloadUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

            const fileRes = await fetch(downloadUrl);
            const buffer = await fileRes.arrayBuffer();

            tempPath = `./temp_${Date.now()}_${Math.random()}.pdf`;
            fs.writeFileSync(tempPath, Buffer.from(buffer));

            // 2. Аналізуємо через AI
            const result = await analyzeResume(tempPath);

            // 3. Якщо збіг >= 70%, додаємо до підсумкового списку
            if (result.match_percentage >= 70) {
                batchResults.push({
                    candidate_name: result.candidate_name || 'Не вказано',
                    match_percentage: result.match_percentage,
                    key_skills: result.key_skills || [],
                    summary: result.summary,
                    filePath: tempPath, // зберігаємо шлях для відправки оригіналу в кінці
                    fileName: document.file_name
                });
            } else {
                console.log(`❌ Кандидат відхилений: ${result.candidate_name || document.file_name} (${result.match_percentage}%)`);
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            }

            // Пауза рівно 5 секунд між файлами для захисту від Rate Limit
            await new Promise(resolve => setTimeout(resolve, 5000));

        } catch (error) {
            console.error("ПОМИЛКА:", error);
            if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }
    });

    // Чекаємо поки вся пачка повністю завершиться (якщо нових файлів немає 4 секунди — видаємо результат)
    batchTimeout = setTimeout(async () => {
        await processingQueue; // дочірлюємо обробку останнього файлу в черзі

        if (!currentChatCtx) return;

        if (batchResults.length > 0) {
            await currentChatCtx.reply(`🏁 **Аналіз завершено! Знайдено підходящих кандидатів: ${batchResults.length}**`);

            // Видаємо кожного підходящого кандидата з його текстом та оригіналом PDF
            for (const candidate of batchResults) {
                const report = 
                    `🔥 **ПІДХОДИТЬ (${candidate.match_percentage}%)**\n\n` +
                    `👤 **Кандидат:** ${candidate.candidate_name}\n` +
                    `🛠 **Ключові навички:** ${candidate.key_skills.join(', ')}\n\n` +
                    `📝 **Висновок AI:**\n${candidate.summary}`;

                await currentChatCtx.replyWithMarkdown(report);

                if (fs.existsSync(candidate.filePath)) {
                    await currentChatCtx.replyWithDocument({ source: candidate.filePath, filename: candidate.fileName }, {
                        caption: `📎 Оригінал резюме (${candidate.match_percentage}% збіг)`
                    });
                    fs.unlinkSync(candidate.filePath); // очищуємо файл після відправки
                }
            }
        } else {
            await currentChatCtx.reply(`❌ **Аналіз завершено.** Жоден кандидат не набрав 70% і вище.`);
        }

        // Очищуємо результати та скидаємо статус для наступного пакету
        batchResults = [];
        isAnalysisStarted = false;
    }, 4000);
});

bot.launch();
console.log('✅ Бот успішно запущено і готовий до роботи!');