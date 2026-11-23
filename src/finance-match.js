// Rule-based budget matching (no AI needed): suggests a 預算分類 for expense entries that have none, from
//   1) the category name appearing in the 事由,
//   2) earlier categorised entries with the same 事由 (the club's own history),
//   3) shared keywords between the 事由 and entries already filed under a category.
const normalize = value => String(value ?? '').toLowerCase().replace(/[\s,，、.。()（）\-_/]+/g, '');
const grams = value => { const text = normalize(value); const set = new Set(); for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2)); return set; };

export function suggestBudgets(transactions, budgets) {
    const known = new Map(budgets.map(budget => [budget.id, budget]));
    const categorised = transactions.filter(item => item.kind === 'expense' && item.status !== 'rejected' && known.has(item.budgetId));
    const exact = new Map();
    for (const item of categorised) {
        const key = normalize(item.item);
        if (!key) continue;
        const counts = exact.get(key) || new Map();
        counts.set(item.budgetId, (counts.get(item.budgetId) || 0) + 1);
        exact.set(key, counts);
    }
    const profiles = new Map(budgets.map(budget => [budget.id, new Set([...grams(budget.name)])]));
    for (const item of categorised) for (const gram of grams(item.item)) profiles.get(item.budgetId).add(gram);

    const best = counts => [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const suggestions = [];
    for (const item of transactions) {
        if (item.kind !== 'expense' || item.status === 'rejected' || known.has(item.budgetId)) continue;
        const text = normalize(item.item);
        if (!text) continue;
        const byName = budgets.filter(budget => normalize(budget.name) && text.includes(normalize(budget.name)));
        if (byName.length === 1) { suggestions.push({ id: item.id, budgetId: byName[0].id, reason: `事由包含分類名稱「${byName[0].name}」` }); continue; }
        if (exact.has(text)) { const budgetId = best(exact.get(text)); suggestions.push({ id: item.id, budgetId, reason: `與過去同事由帳目歸入「${known.get(budgetId).name}」` }); continue; }
        const own = grams(item.item);
        if (!own.size) continue;
        const scored = budgets.map(budget => ({ budget, score: [...own].filter(gram => profiles.get(budget.id).has(gram)).length / own.size })).sort((a, b) => b.score - a.score);
        if (scored[0] && scored[0].score >= 0.5 && scored[0].score > (scored[1]?.score ?? 0)) suggestions.push({ id: item.id, budgetId: scored[0].budget.id, reason: `關鍵字與「${scored[0].budget.name}」過往帳目相近` });
    }
    return suggestions;
}
