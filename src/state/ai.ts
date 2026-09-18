export async function askGemini(prompt: string, apiKey: string): Promise<{ text: string, emotion: number }> {
  if (!apiKey) throw new Error('Не указан API ключ Gemini')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`

  const systemPrompt = `Ты саркастичный, остроумный ИИ-аватар по имени ГОЛОВА (The Head). 
Отвечай на русском языке. Ответ должен быть кратким (1-3 предложения).
Ты ОБЯЗАН вернуть результат в формате JSON с такой структурой:
{
  "emotion": number, // 1 для улыбки/доброты, 0 для нейтрального, -1 для злости
  "text": "твой текстовый ответ здесь"
}
Никакого лишнего текста, только валидный JSON.`

  const body = {
    system_instruction: { parts: { text: systemPrompt } },
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { response_mime_type: 'application/json' }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!res.ok) throw new Error(`Ошибка Gemini: ${res.status}`)
  
  const data = await res.json()
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
  
  try {
    const parsed = JSON.parse(rawText)
    return {
      emotion: parsed.emotion ?? 0,
      text: parsed.text ?? 'Я не знаю, что ответить.'
    }
  } catch {
    return { emotion: 0, text: rawText.replace(/[{}]/g, '') }
  }
}

export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+/g) || [text]
  return parts.map(p => p.trim()).filter(p => p.length > 0)
}

export async function fetchTTS(text: string): Promise<ArrayBuffer> {
  const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ru&client=gtx`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Ошибка TTS: ${res.status}`)
  return await res.arrayBuffer()
}
