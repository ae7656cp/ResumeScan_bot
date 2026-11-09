require('dotenv').config();

async function checkModels() {
    try {
        const apiKey = process.env.GROQ_API_KEY;
        const response = await fetch('https://api.groq.com/openai/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        const data = await response.json();
        console.log("Доступні вам моделі Groq:");
        if (data.data) {
            data.data.forEach(m => console.log("-", m.id));
        } else {
            console.log(data);
        }
    } catch (e) {
        console.error("Помилка:", e.message);
    }
}

checkModels();