// HTTP routes for the finance ledger: transactions, review, budgets and spreadsheet import.
import { canManageUsers, canManageFinance } from './auth.js';
import { readJsonObject } from './request.js';
import { sessionUser } from './session.js';
import { ValidationError, financeAmount, financeText, financeDate, importedDate, importAmount, parseStoredList } from './validation.js';
import { FINANCE_BUDGETS_KEY, FINANCE_TRANSACTIONS_KEY } from './kv-keys.js';

function transactionTotals(transactions) {
    const approved = transactions.filter(item => item.status === 'approved');
    const pending = transactions.filter(item => item.status === 'pending');
    const sum = (items, key) => items.reduce((total, item) => total + (item[key] || 0), 0);
    return {
        cashBalance: sum(approved, 'cashDelta'), postalBalance: sum(approved, 'postalDelta'),
        income: sum(approved, 'income'), expense: sum(approved, 'expense'),
        pendingCount: pending.length, pendingIncome: sum(pending, 'income'), pendingExpense: sum(pending, 'expense')
    };
}

// Returns a Response for /api/finance/*, or null for any other path.
export async function handleFinanceRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ==================== API: Finance ledger, budget, import, and review ====================
    if (path === '/api/finance/summary' && method === 'GET') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const transactions = parseStoredList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
        const budgets = parseStoredList(await env.DRONE_DB.get(FINANCE_BUDGETS_KEY));
        const approved = transactions.filter(item => item.status === 'approved');
        const spentByCategory = Object.fromEntries(budgets.map(item => [item.id, 0]));
        for (const item of approved) if (item.kind === 'expense' && item.budgetId && spentByCategory[item.budgetId] !== undefined) spentByCategory[item.budgetId] += item.expense;
        return Response.json({
            transactions: transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
            budgets: budgets.map(item => ({ ...item, spent: spentByCategory[item.id] || 0 })),
            totals: transactionTotals(transactions)
        });
    }

    if (path === '/api/finance/transactions' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const body = await readJsonObject(request);
        const kind = String(body.kind || '');
        if (!['income', 'expense', 'transfer'].includes(kind)) return Response.json({ error: '收支類型無效' }, { status: 400 });
        const amount = financeAmount(body.amount);
        if (!amount) return Response.json({ error: '金額必須為 1 至 1,000,000,000 的整數' }, { status: 400 });
        const account = String(body.account || 'cash');
        if (!['cash', 'postal'].includes(account)) return Response.json({ error: '帳戶無效' }, { status: 400 });
        const item = financeText(body.item, '事由', 120);
        const date = financeDate(body.date);
        const transaction = {
            id: crypto.randomUUID(), date, item, kind, amount,
            income: kind === 'income' ? amount : 0, expense: kind === 'expense' ? amount : 0,
            cashDelta: kind === 'transfer' ? (account === 'cash' ? -amount : amount) : (account === 'cash' ? (kind === 'income' ? amount : -amount) : 0),
            postalDelta: kind === 'transfer' ? (account === 'cash' ? amount : -amount) : (account === 'postal' ? (kind === 'income' ? amount : -amount) : 0),
            budgetId: typeof body.budgetId === 'string' ? body.budgetId : '', status: 'pending',
            createdBy: user.username, createdAt: new Date().toISOString(), source: 'manual'
        };
        const transactions = parseStoredList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
        transactions.push(transaction);
        await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify(transactions));
        return Response.json(transaction, { status: 201 });
    }

    if (path.startsWith('/api/finance/transactions/') && path.endsWith('/review') && method === 'PATCH') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageUsers(user)) return Response.json({ error: '僅社長可審核收支' }, { status: 403 });
        const id = path.slice('/api/finance/transactions/'.length, -'/review'.length);
        const body = await readJsonObject(request);
        const status = body.status === 'approved' || body.status === 'rejected' ? body.status : null;
        if (!status) return Response.json({ error: '審核結果無效' }, { status: 400 });
        const transactions = parseStoredList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
        const transaction = transactions.find(item => item.id === id);
        if (!transaction) return Response.json({ error: '帳目不存在' }, { status: 404 });
        if (transaction.status !== 'pending') return Response.json({ error: '此帳目已完成審核' }, { status: 409 });
        transaction.status = status;
        transaction.reviewedBy = user.username;
        transaction.reviewedAt = new Date().toISOString();
        transaction.reviewNote = status === 'rejected' ? financeText(body.note, '退回原因', 200) : '';
        await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify(transactions));
        return Response.json(transaction);
    }

    if (path.startsWith('/api/finance/transactions/') && method === 'DELETE') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const id = path.slice('/api/finance/transactions/'.length);
        if (!id || id.includes('/')) return Response.json({ error: '帳目編號無效' }, { status: 400 });
        const transactions = parseStoredList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
        const transaction = transactions.find(item => item.id === id);
        if (!transaction) return Response.json({ error: '帳目不存在' }, { status: 404 });
        if (transaction.status !== 'rejected') return Response.json({ error: '只有已退回帳目可以刪除' }, { status: 409 });
        await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify(transactions.filter(item => item.id !== id)));
        return Response.json({ success: true });
    }

    if (path === '/api/finance/budgets' && ['GET', 'PUT'].includes(method)) {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        if (method === 'GET') return Response.json(parseStoredList(await env.DRONE_DB.get(FINANCE_BUDGETS_KEY)));
        const { budgets } = await readJsonObject(request);
        if (!Array.isArray(budgets) || budgets.length > 100) return Response.json({ error: '預算最多 100 個分類' }, { status: 400 });
        const names = new Set();
        const normalized = budgets.map(item => {
            const name = financeText(item.name, '分類名稱', 60);
            if (names.has(name)) throw new ValidationError('預算分類不可重複');
            names.add(name);
            const planned = financeAmount(item.planned);
            if (planned === null) throw new ValidationError('預算金額無效');
            return { id: typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ? item.id : crypto.randomUUID(), name, planned };
        });
        await env.DRONE_DB.put(FINANCE_BUDGETS_KEY, JSON.stringify(normalized));
        return Response.json(normalized);
    }

    if (path === '/api/finance/import' && method === 'POST') {
        const user = await sessionUser(request, env);
        if (!user) return Response.json({ error: '未授權' }, { status: 401 });
        if (!canManageFinance(user)) return Response.json({ error: '權限不足' }, { status: 403 });
        const { rows } = await readJsonObject(request);
        if (!Array.isArray(rows) || rows.length < 1 || rows.length > 1000) return Response.json({ error: '匯入資料需介於 1 至 1,000 筆' }, { status: 400 });
        let previousCash = 0, previousPostal = 0;
        const imported = rows.map((row, index) => {
            const date = importedDate(row.date);
            const item = financeText(row.item, `第 ${index + 1} 列事宜`, 120);
            const income = importAmount(row.income, `第 ${index + 1} 列收入`);
            const expense = importAmount(row.expense, `第 ${index + 1} 列支出`);
            if (income && expense) throw new ValidationError(`第 ${index + 1} 列不可同時填寫收入與支出`);
            const cashBalance = importAmount(row.cashBalance, `第 ${index + 1} 列現金餘額`);
            const postalBalance = importAmount(row.postalBalance, `第 ${index + 1} 列郵局餘額`);
            const cashDelta = cashBalance - previousCash;
            const postalDelta = postalBalance - previousPostal;
            previousCash = cashBalance; previousPostal = postalBalance;
            return { id: crypto.randomUUID(), date, item, kind: income ? 'income' : expense ? 'expense' : 'transfer', amount: income || expense || Math.abs(cashDelta) || Math.abs(postalDelta), income, expense, cashDelta, postalDelta, budgetId: '', status: 'pending', createdBy: user.username, createdAt: new Date().toISOString(), source: 'legacy-spreadsheet' };
        });
        const transactions = parseStoredList(await env.DRONE_DB.get(FINANCE_TRANSACTIONS_KEY));
        await env.DRONE_DB.put(FINANCE_TRANSACTIONS_KEY, JSON.stringify([...transactions, ...imported]));
        return Response.json({ imported: imported.length, transactions: imported }, { status: 201 });
    }

    return null;
}
