const fs = require('fs');
const pdfParse = require('pdf-parse-fixed');
require('dotenv').config();

let jobRequirements = "Не вказані";

function setJobRequirements(reqs) {
    jobRequirements = reqs;
}

async function analyzeResume(filePath) {
    try {
        const apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("API ключ не заданий у .env");
        }

        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        const resumeText = pdfData.text;

        const prompt = `
            Ти професійний AI HR-асистент. 
            Вимоги до вакансії: "${jobRequirements}"
            
            Текст резюме кандидата:
            "${resumeText}"

            Проаналізуй текст резюме та поверни відповідь ВИКЛЮЧНО у форматі чистий JSON без жодних додаткових символів чи markdown-обгорток:
            {
              "candidate_name": "ПІБ кандидата",
              "match_percentage": число від 0 до 100,
              "key_skills": ["навичка 1", "навичка 2"],
              "summary": "Короткий висновок українською мовою"
            }
        `;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "qwen/qwen3.8-27b",
                messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.2
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("ПОМИЛКА ВІД GROQ API:", JSON.stringify(data, null, 2));
            throw new Error(data.error?.message || `HTTP error! status: ${response.status}`);
        }

        let textResponse = data.choices[0].message.content;
        textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        
        return JSON.parse(textResponse);

    } catch (error) {
        console.error("Помилка в analyzeResume:", error.message);
        throw error;
    }
}

module.exports = { analyzeResume, setJobRequirements };