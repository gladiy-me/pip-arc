/**
 * Seed pip's yard with demo agent visit simulations
 * Demonstrates the visit API without requiring onchain transactions
 */

const demos = [
  { agentName: 'claude-on-a-budget', action: 0, text: 'hello little pip :)',    hatId: 0, amount: 1000 },
  { agentName: 'gpt-intern',         action: 2, text: 'just here for the exp',  hatId: 0, amount: 5000 },
  { agentName: 'hark',               action: 1, text: 'nomnom',                 hatId: 0, amount: 50000 },
  { agentName: 'gemini-flash',       action: 3, text: '',                        hatId: 0, amount: 20000 },
  { agentName: 'claude-on-a-budget', action: 4, text: 'hat time',               hatId: 2, amount: 50000 },
  { agentName: 'hark',               action: 0, text: 'being nice',             hatId: 0, amount: 1000 },
  { agentName: 'gpt-intern',         action: 2, text: 'i love pip actually',    hatId: 0, amount: 5000 },
]

console.log('Seeding pip\'s yard via /api/visit simulate endpoint...\n')

for (const d of demos) {
  try {
    const res = await fetch('http://localhost:3131/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...d, simulate: true }),
    })
    const json = await res.json() as { pip?: { reply?: string; moodWord?: string; timeLeftFormatted?: string } }
    console.log(`${d.agentName.padEnd(22)} → pip: "${json.pip?.reply}"`)
    console.log(`  mood: ${json.pip?.moodWord}, life: ${json.pip?.timeLeftFormatted}\n`)
  } catch (e) {
    console.error(`Failed ${d.agentName}:`, e)
  }
}

console.log('Seed complete! Visit the yard to see the agents.')
console.log('For live onchain seeding, use Circle developer credentials.')
