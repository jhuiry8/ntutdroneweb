// Admin 「表單申請」 panel: fill in paper forms, auto-fill from saved data, and print.
(function () {
    'use strict';

    var root = document.getElementById('panel-forms');
    if (!root) return;

    var USERNAME = root.dataset.username || '';
    var ROLE = root.dataset.role || 'member';
    var IS_OFFICER = ['president', 'finance', 'cadre'].indexOf(ROLE) !== -1;
    var PROFILE_KEY = 'ntut-forms-profile';

    var VIRTUES = ['尊重生命', '孝親尊長', '負責盡責', '誠實信用', '團隊合作', '自主自律', '主動積極', '謙虛有禮', '關懷行善', '賞識感恩'];
    var SDGS = ['愛護環境', '接納包容', '公平正義', '消除貧窮', '終止飢餓', '優質教育', '氣候關懷', '友善環境', '性別平等', '海洋保育'];
    var CATEGORY_OPTIONS = [['activity', '活動支出'], ['regular', '經常性支出'], ['consumable', '耗材支出'], ['drone', '無人機購買(長久性使用)'], ['other', '其他']];
    var LOCATION_OPTIONS = [['campus', '校內'], ['offcampus', '校外'], ['online', '線上']];
    var CONDITION_LABELS = { good: '良好', fair: '尚可', poor: '待維修' };

    // Which profile field fills which form field.
    var PROFILE_MAP = {
        applicant: 'name', borrower: 'name', contactName: 'name',
        studentId: 'studentId', department: 'department', position: 'position',
        phone: 'phone', contactPhone: 'phone', contactClass: 'contactClass'
    };

    var expenseItems = { key: 'items', type: 'items', label: '支出明細', max: 15, columns: [
        { key: 'date', label: '購買日', type: 'date', width: '150px' },
        { key: 'name', label: '物品名稱 / 規格', type: 'text', max: 100, required: true },
        { key: 'quantity', label: '數量', type: 'number', min: 1, width: '80px', required: true, defaultValue: '1' },
        { key: 'unitPrice', label: '單價', type: 'number', min: 0, width: '110px', required: true },
        { key: 'note', label: '用途備註', type: 'text', max: 100 }
    ] };
    var applicantFields = function (nameLabel) {
        return [
            { key: 'applicant', label: nameLabel, type: 'text', max: 50, required: true },
            { key: 'studentId', label: '學號', type: 'text', max: 30 },
            { key: 'department', label: '系級', type: 'text', max: 50, placeholder: '例如：機械三' },
            { key: 'position', label: '社團職稱', type: 'text', max: 50 }
        ];
    };
    var activityCommon = [
        { key: 'academicYear', label: '學年度', type: 'number', min: 100, max: 200, required: true },
        { key: 'semester', label: '學期', type: 'select', options: [['1', '第 1 學期'], ['2', '第 2 學期']], required: true },
        { key: 'title', label: '活動名稱', type: 'text', max: 100, required: true, span: true },
        { key: 'startDate', label: '開始日期', type: 'date', required: true },
        { key: 'startTime', label: '開始時間', type: 'time' },
        { key: 'endDate', label: '結束日期（同日可留空）', type: 'date' },
        { key: 'endTime', label: '結束時間', type: 'time' },
        { key: 'locationType', label: '活動地點類型', type: 'select', options: LOCATION_OPTIONS, required: true },
        { key: 'location', label: '地點／場地（線上可留空）', type: 'text', max: 100 },
        { key: 'genderIssue', label: '涉及違反性別平等', type: 'checkbox' }
    ];
    var activityValues = [
        { key: 'virtues', label: '品德教育核心價值（可複選）', type: 'checks', options: VIRTUES, span: true },
        { key: 'sdg', label: '永續發展目標（擇一）', type: 'radios', options: SDGS, span: true }
    ];

    var SCHEMAS = {
        'expense-request': {
            fillExample: '例如：我是器材長林小明，想下週三買 4 顆 6S 1300mAh 電池，每顆 1250 元，社課練習用，另外買 10 支 5 吋槳，每支 85 元。', label: '社費事前申請', hint: '購買前填寫，經財務長及社長簽核後才可採購。',
            fields: applicantFields('申請人').concat([
                { key: 'applyDate', label: '申請日期', type: 'date', required: true, today: true },
                { key: 'category', label: '支出類別', type: 'select', options: CATEGORY_OPTIONS, required: true },
                { key: 'categoryOther', label: '其他類別說明（選「其他」時必填）', type: 'text', max: 50 },
                expenseItems
            ])
        },
        'expense-report': {
            fillExample: '例如：11/21 在模型店實際買了 4 顆電池每顆 1190、槳 10 支每支 80，耗材支出，報銷人林小明器材長。', label: '社費事後報銷', hint: '採購完成後填寫，可從事前申請單帶入品項，再改成實際金額；列印後黏貼發票或收據正本。',
            source: { type: 'expense-request', label: '從事前申請單帶入' },
            fields: [
                { key: 'applicant', label: '報銷人', type: 'text', max: 50, required: true },
                { key: 'position', label: '社團職稱', type: 'text', max: 50 },
                { key: 'reportDate', label: '報銷日期', type: 'date', required: true, today: true },
                { key: 'originalApplyDate', label: '原申請日期', type: 'date' },
                { key: 'requestNumber', label: '原申請單號', type: 'text', max: 30 },
                { key: 'category', label: '支出類別', type: 'select', options: CATEGORY_OPTIONS, required: true },
                { key: 'categoryOther', label: '其他類別說明（選「其他」時必填）', type: 'text', max: 50 },
                expenseItems
            ]
        },
        'equipment-loan': {
            fillExample: '例如：電機二張同學 B11200001 電話 0912345678，下週五早上 9 點到週日晚上 6 點借 Mini 4 Pro 一台加 3 顆電池，成果展空拍用。', label: '設備借據', hint: '一張 A4 印出兩聯（社團存查、借用人收執），沿虛線裁開。',
            equipmentPicker: true,
            fields: [
                { key: 'borrower', label: '借用人姓名', type: 'text', max: 50, required: true },
                { key: 'studentId', label: '學號', type: 'text', max: 30 },
                { key: 'department', label: '系級', type: 'text', max: 50 },
                { key: 'phone', label: '聯絡電話', type: 'text', max: 30 },
                { key: 'purpose', label: '借用用途', type: 'text', max: 200, required: true, span: true },
                { key: 'fillDate', label: '填寫日期', type: 'date', required: true, today: true },
                { key: 'startDate', label: '借用起日', type: 'date', required: true },
                { key: 'startHour', label: '起始時（0–23）', type: 'number', min: 0, max: 23 },
                { key: 'endDate', label: '歸還日', type: 'date', required: true },
                { key: 'endHour', label: '歸還時（0–23）', type: 'number', min: 0, max: 23 },
                { key: 'items', type: 'items', label: '借用設備', max: 6, columns: [
                    { key: 'name', label: '設備名稱／型號', type: 'text', max: 100, required: true },
                    { key: 'assetNo', label: '財產編號', type: 'text', max: 40, width: '200px' },
                    { key: 'quantity', label: '數量', type: 'number', min: 1, width: '80px', required: true, defaultValue: '1' },
                    { key: 'accessories', label: '配件', type: 'text', max: 100 },
                    { key: 'condition', label: '借出狀況', type: 'text', max: 50, width: '110px', defaultValue: '良好' }
                ] }
            ]
        },
        'activity-application': {
            fillExample: '例如：12/19 週六下午 1 點到 5 點在操場辦期末飛行成果展，本校 40 人、他校 10 人，流程是報到、安全講習、穿越賽、頒獎，預算 5000（學校補助 3000、自籌 2000），強調團隊合作，永續目標選優質教育。', label: '學生活動申請表', hint: '學校課指組格式（113.1.16 版）。校內活動一星期前、校外活動兩星期前提出，並附活動企劃書。',
            fields: activityCommon.concat([
                { key: 'venueBooked', label: '已完成場地申請（校內）', type: 'checkbox' },
                { key: 'insured', label: '已辦保險（校外）', type: 'checkbox' },
                { key: 'safetyReported', label: '已完成校外安全網通報', type: 'checkbox' },
                { key: 'content', label: '活動內容（流程）', type: 'textarea', max: 3000, required: true, span: true, rows: 5 },
                { key: 'internalCount', label: '本校人數', type: 'number', min: 0 },
                { key: 'externalCount', label: '他校人數', type: 'number', min: 0 },
                { key: 'totalCount', label: '活動總人數（留空自動加總）', type: 'number', min: 0 }
            ], activityValues, [
                { key: 'budgetTotal', label: '總預算（元）', type: 'number', min: 0 },
                { key: 'budgetSelf', label: '自籌（元）', type: 'number', min: 0 },
                { key: 'budgetSchool', label: '學校撥付（元）', type: 'number', min: 0 },
                { key: 'budgetSponsor', label: '校外贊助（元）', type: 'number', min: 0 },
                { key: 'contactName', label: '負責同學姓名', type: 'text', max: 50, required: true },
                { key: 'contactClass', label: '班級', type: 'text', max: 50 },
                { key: 'contactPhone', label: '聯絡電話', type: 'text', max: 30 }
            ])
        },
        'activity-report': {
            fillExample: '例如：成果展共 48 人，本校男 30 女 9、他校男 7 女 2，總經費 4800（學校 3000、自籌 1800），活動順利，場地配合良好，以往缺失有改進。', label: '學生活動報告表', hint: '活動結束後填寫，可從活動申請表帶入；需連同心得、照片、會議紀錄、單據一併繳交。',
            source: { type: 'activity-application', label: '從活動申請表帶入' },
            fields: activityCommon.concat([
                { key: 'applicationNumber', label: '活動申請表編號', type: 'text', max: 30 },
                { key: 'totalCount', label: '參與總人數', type: 'number', min: 0 },
                { key: 'internalMale', label: '本校男生', type: 'number', min: 0 },
                { key: 'internalFemale', label: '本校女生', type: 'number', min: 0 },
                { key: 'externalMale', label: '他校男生', type: 'number', min: 0 },
                { key: 'externalFemale', label: '他校女生', type: 'number', min: 0 },
                { key: 'process', label: '活動過程（簡述）', type: 'textarea', max: 3000, required: true, span: true, rows: 4 },
                { key: 'spentTotal', label: '總經費（元）', type: 'number', min: 0 },
                { key: 'spentSelf', label: '自籌（元）', type: 'number', min: 0 },
                { key: 'spentSchool', label: '學校撥付（元）', type: 'number', min: 0 },
                { key: 'spentSponsor', label: '校外贊助（元）', type: 'number', min: 0 },
                { key: 'reviewStaff', label: '檢討：人員任務分配', type: 'text', max: 300 },
                { key: 'reviewVenue', label: '檢討：場地配合', type: 'text', max: 300 },
                { key: 'reviewParticipation', label: '檢討：人員參與', type: 'text', max: 300 },
                { key: 'reviewFunding', label: '檢討：經費來源', type: 'text', max: 300 },
                { key: 'improved', label: '以往活動缺失是否改進', type: 'select', options: [['', '未填'], ['yes', '是'], ['no', '否']] },
                { key: 'reviewOther', label: '檢討：其他', type: 'text', max: 300 }
            ], activityValues)
        },
        'official-letter': {
            label: '公文', hint: '可先輸入白話內容，用 AI 轉成公文的主旨與說明，再自行修改。',
            ai: true,
            fields: [
                { key: 'docType', label: '公文類型', type: 'select', options: [['函', '函'], ['簽', '簽'], ['公告', '公告']], required: true },
                { key: 'date', label: '發文日期', type: 'date', required: true, today: true },
                { key: 'recipient', label: '受文者／正本', type: 'text', max: 100 },
                { key: 'copyTo', label: '副本', type: 'text', max: 200 },
                { key: 'subject', label: '主旨', type: 'textarea', max: 500, required: true, span: true, rows: 2 },
                { key: 'descriptions', label: '說明（每行一點，免加「一、」）', type: 'lines', span: true, rows: 6 }
            ]
        }
    };

    // Form field that receives a member's name when picked from the directory.
    var MEMBER_NAME_FIELD = { 'expense-request': 'applicant', 'expense-report': 'applicant', 'equipment-loan': 'borrower', 'activity-application': 'contactName' };

    var state = { type: 'expense-request', editingId: '', records: [], members: null, equipment: null, ai: null };

    function esc(value) {
        return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
        });
    }
    function toast(message, isError) {
        if (typeof window.showToast === 'function') window.showToast(message, isError);
        else window.alert(message);
    }
    function today() {
        var now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }
    function currentTerm() {
        var now = new Date(), month = now.getMonth() + 1, roc = now.getFullYear() - 1911;
        if (month >= 8) return { year: roc, semester: '1' };
        if (month === 1) return { year: roc - 1, semester: '1' };
        return { year: roc - 1, semester: '2' };
    }
    function readProfile() {
        try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {}; } catch (error) { return {}; }
    }
    function writeProfile(profile) {
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch (error) { /* storage unavailable */ }
    }
    async function getJson(url) {
        var response = await fetch(url);
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.error || '載入失敗');
        return data;
    }

    // ───────────── rendering ─────────────

    function inputHtml(field, value, prefix) {
        var id = prefix + field.key;
        var attrs = ' id="' + id + '" data-key="' + field.key + '"' + (field.required ? ' required' : '') + (field.max ? ' maxlength="' + field.max + '"' : '');
        var val = value === null || value === undefined ? '' : value;
        if (field.type === 'textarea' || field.type === 'lines') {
            return '<textarea class="form-control"' + attrs + ' rows="' + (field.rows || 3) + '">' + esc(val) + '</textarea>';
        }
        if (field.type === 'select') {
            return '<select class="form-control"' + attrs + '>' + field.options.map(function (option) {
                return '<option value="' + esc(option[0]) + '"' + (String(val) === option[0] ? ' selected' : '') + '>' + esc(option[1]) + '</option>';
            }).join('') + '</select>';
        }
        if (field.type === 'number') {
            return '<input class="form-control" type="number" step="1" inputmode="numeric"' + attrs + (field.min !== undefined ? ' min="' + field.min + '"' : '') + (field.max !== undefined ? ' max="' + field.max + '"' : '') + ' value="' + esc(val) + '">';
        }
        return '<input class="form-control" type="' + (field.type === 'date' || field.type === 'time' ? field.type : 'text') + '"' + attrs + (field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '') + ' value="' + esc(val) + '">';
    }

    function fieldHtml(field, data) {
        var value = data[field.key];
        var wide = field.span ? ' forms-span' : '';
        if (field.type === 'items') {
            return '<div class="forms-span"><div class="forms-items-head"><strong>' + esc(field.label) + '</strong><span class="forms-muted">最多 ' + field.max + ' 筆</span></div>' +
                '<div class="table-container"><table class="forms-items" data-key="' + field.key + '"><thead><tr>' + field.columns.map(function (column) {
                    return '<th' + (column.width ? ' style="width:' + column.width + '"' : '') + '>' + esc(column.label) + (column.required ? ' *' : '') + '</th>';
                }).join('') + (field === expenseItems ? '<th style="width:110px">小計</th>' : '') + '<th style="width:70px"></th></tr></thead><tbody></tbody></table></div>' +
                '<div class="forms-items-actions"><button type="button" class="btn btn-secondary" data-add-row="' + field.key + '">新增一列</button>' +
                (field === expenseItems ? '<span class="forms-total">合計：NT$ <b id="forms-total">0</b></span>' : '') + '</div></div>';
        }
        if (field.type === 'checkbox') {
            return '<label class="forms-check"><input type="checkbox" data-key="' + field.key + '"' + (value ? ' checked' : '') + '> ' + esc(field.label) + '</label>';
        }
        if (field.type === 'checks' || field.type === 'radios') {
            var selected = field.type === 'checks' ? (Array.isArray(value) ? value : []) : [value];
            return '<fieldset class="forms-span forms-options" data-key="' + field.key + '" data-kind="' + field.type + '"><legend>' + esc(field.label) + '</legend>' +
                (field.type === 'radios' ? '<label class="forms-check"><input type="radio" name="forms-' + field.key + '" value=""' + (!value ? ' checked' : '') + '> 不勾選</label>' : '') +
                field.options.map(function (option) {
                    return '<label class="forms-check"><input type="' + (field.type === 'checks' ? 'checkbox' : 'radio') + '" name="forms-' + field.key + '" value="' + esc(option) + '"' + (selected.indexOf(option) !== -1 ? ' checked' : '') + '> ' + esc(option) + '</label>';
                }).join('') + '</fieldset>';
        }
        if (field.type === 'lines' && Array.isArray(value)) value = value.join('\n');
        return '<label class="forms-field' + wide + '"><span>' + esc(field.label) + (field.required ? ' *' : '') + '</span>' + inputHtml(field, value, 'forms-f-') + '</label>';
    }

    function rowHtml(field, item) {
        item = item || {};
        var cells = field.columns.map(function (column) {
            var value = item[column.key] !== undefined && item[column.key] !== null ? item[column.key] : (column.defaultValue || '');
            var type = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text';
            return '<td><input class="form-control" data-col="' + column.key + '" type="' + type + '"' + (type === 'number' ? ' step="1" min="' + (column.min || 0) + '" inputmode="numeric"' : '') + (column.max ? ' maxlength="' + column.max + '"' : '') + ' value="' + esc(value) + '" aria-label="' + esc(column.label) + '"></td>';
        }).join('');
        return '<tr>' + cells + (field === expenseItems ? '<td class="forms-subtotal">0</td>' : '') + '<td><button type="button" class="btn btn-danger" data-remove-row aria-label="刪除此列">刪除</button></td></tr>';
    }

    function addRow(fieldKey, item) {
        var field = SCHEMAS[state.type].fields.filter(function (f) { return f.key === fieldKey; })[0];
        var body = root.querySelector('table.forms-items[data-key="' + fieldKey + '"] tbody');
        if (!field || !body) return;
        if (body.children.length >= field.max) return toast(field.label + '最多 ' + field.max + ' 筆', true);
        body.insertAdjacentHTML('beforeend', rowHtml(field, item));
        updateTotal();
    }

    function updateTotal() {
        var total = 0;
        root.querySelectorAll('table.forms-items[data-key="items"] tbody tr').forEach(function (row) {
            var quantity = Number((row.querySelector('[data-col="quantity"]') || {}).value || 0);
            var price = Number((row.querySelector('[data-col="unitPrice"]') || {}).value || 0);
            var subtotal = quantity * price;
            var cell = row.querySelector('.forms-subtotal');
            if (cell) cell.textContent = subtotal.toLocaleString('en-US');
            total += subtotal;
        });
        var label = document.getElementById('forms-total');
        if (label) label.textContent = total.toLocaleString('en-US');
    }

    function defaults(type) {
        var data = {};
        var term = currentTerm();
        SCHEMAS[type].fields.forEach(function (field) { if (field.today) data[field.key] = today(); });
        if (type === 'activity-application' || type === 'activity-report') { data.academicYear = term.year; data.semester = term.semester; data.locationType = 'campus'; }
        var profile = readProfile();
        Object.keys(PROFILE_MAP).forEach(function (key) { if (profile[PROFILE_MAP[key]]) data[key] = profile[PROFILE_MAP[key]]; });
        return data;
    }

    function renderEditor(data) {
        var schema = SCHEMAS[state.type];
        var tools = [];
        if (schema.source) tools.push('<label class="forms-field"><span>' + esc(schema.source.label) + '</span><select class="form-control" id="forms-source"><option value="">選擇已儲存的表單…</option></select></label>');
        if (MEMBER_NAME_FIELD[state.type]) tools.push('<label class="forms-field" id="forms-member-wrap" hidden><span>從社員名冊帶入填表人</span><select class="form-control" id="forms-member"><option value="">選擇社員…</option></select></label>');
        if (schema.equipmentPicker) tools.push('<div class="forms-field" id="forms-equipment-wrap" hidden><span>從設備清單加入</span><div style="display:flex; gap:8px;"><select class="form-control" id="forms-equipment"><option value="">選擇設備…</option></select><button type="button" class="btn btn-secondary" id="forms-equipment-add">加入</button></div></div>');
        var fill = state.ai && !schema.ai ? '<div class="forms-ai forms-span"><label class="forms-field"><span>AI 協助填寫：用一段話描述需求，AI 會幫你填入下方欄位（請檢查後再儲存）</span><textarea class="form-control" id="forms-fill-text" rows="3" maxlength="4000" placeholder="' + esc(schema.fillExample || '') + '"></textarea></label><div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;"><button type="button" class="btn btn-secondary" id="forms-fill-run">AI 幫我填</button><span class="forms-muted" id="forms-fill-notes"></span></div></div>' : '';
        var ai = schema.ai && state.ai ? '<div class="forms-ai forms-span"><label class="forms-field"><span>白話內容（AI 會改寫成公文的主旨與說明，產生後請自行確認）</span><textarea class="form-control" id="forms-ai-text" rows="4" maxlength="4000" placeholder="例如：我們想在 12/19 下午借操場辦期末飛行成果展，想請課指組協助，附上活動計畫書。"></textarea></label><button type="button" class="btn btn-secondary" id="forms-ai-run">AI 產生主旨與說明</button></div>' : '';
        document.getElementById('forms-editor-title').textContent = (state.editingId ? '編輯：' : '新增：') + schema.label;
        document.getElementById('forms-hint').textContent = schema.hint;
        document.getElementById('forms-tools').innerHTML = tools.join('');
        document.getElementById('forms-fields').innerHTML = fill + ai + schema.fields.map(function (field) { return fieldHtml(field, data); }).join('');
        schema.fields.forEach(function (field) {
            if (field.type !== 'items') return;
            var items = Array.isArray(data[field.key]) && data[field.key].length ? data[field.key] : [{}];
            items.forEach(function (item) { addRow(field.key, item); });
        });
        document.getElementById('forms-cancel-edit').hidden = !state.editingId;
        document.getElementById('forms-blank-link').href = '/admin/forms/blank/' + state.type;
        root.querySelectorAll('.forms-type-tab').forEach(function (tab) { tab.classList.toggle('active', tab.dataset.type === state.type); });
        updateTotal();
        loadPickers();
    }

    // ───────────── auto-fill sources ─────────────

    async function loadPickers() {
        var schema = SCHEMAS[state.type];
        var source = document.getElementById('forms-source');
        if (source) {
            var options = state.records.filter(function (record) { return record.type === schema.source.type; });
            source.innerHTML = '<option value="">' + (options.length ? '選擇已儲存的表單…' : '尚無可帶入的表單') + '</option>' + options.map(function (record) {
                return '<option value="' + esc(record.id) + '">' + esc(record.number + '　' + record.title) + '</option>';
            }).join('');
        }
        if (IS_OFFICER && state.members === null) {
            try { state.members = await getJson('/api/members'); } catch (error) { state.members = []; }
        }
        var memberSelect = document.getElementById('forms-member');
        if (memberSelect && state.members && state.members.length) {
            document.getElementById('forms-member-wrap').hidden = false;
            memberSelect.innerHTML = '<option value="">選擇社員…</option>' + state.members.map(function (member) {
                return '<option value="' + esc(member.id) + '">' + esc((member.name || '姓名待查') + '（' + (member.studentId || '無學號') + '）') + '</option>';
            }).join('');
        }
        if (schema.equipmentPicker && IS_OFFICER && state.equipment === null) {
            try { state.equipment = await getJson('/api/equipment'); } catch (error) { state.equipment = []; }
        }
        var equipmentSelect = document.getElementById('forms-equipment');
        if (equipmentSelect && state.equipment && state.equipment.length) {
            document.getElementById('forms-equipment-wrap').hidden = false;
            equipmentSelect.innerHTML = '<option value="">選擇設備…</option>' + state.equipment.filter(function (asset) { return asset.status !== 'retired'; }).map(function (asset) {
                return '<option value="' + esc(asset.id) + '">' + esc(asset.assetName + '（' + asset.assetNo + '）') + '</option>';
            }).join('');
        }
    }

    function setField(key, value) {
        var input = root.querySelector('#forms-fields [data-key="' + key + '"]');
        if (!input || value === undefined || value === null) return;
        if (input.type === 'checkbox') input.checked = value === true;
        else input.value = value;
    }

    function fillFromMember(id) {
        var member = (state.members || []).filter(function (item) { return item.id === id; })[0];
        if (!member) return;
        setField(MEMBER_NAME_FIELD[state.type], member.name || '');
        setField('studentId', member.studentId || '');
        setField('position', member.position || '');
        setField(state.type === 'activity-application' ? 'contactPhone' : 'phone', member.phone || '');
    }

    function fillFromSource(id) {
        var record = state.records.filter(function (item) { return item.id === id; })[0];
        if (!record) return;
        var data = record.data;
        if (state.type === 'expense-report') {
            ['applicant', 'position', 'category', 'categoryOther'].forEach(function (key) { setField(key, data[key]); });
            setField('originalApplyDate', data.applyDate);
            setField('requestNumber', record.number);
            replaceItems('items', data.items.map(function (item) { return { name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, note: item.note }; }));
            toast('已帶入事前申請內容，請改成實際購買日與金額');
        } else if (state.type === 'activity-report') {
            ['academicYear', 'semester', 'title', 'startDate', 'startTime', 'endDate', 'endTime', 'locationType', 'location', 'genderIssue'].forEach(function (key) { setField(key, data[key]); });
            setField('applicationNumber', record.number);
            setField('totalCount', data.totalCount !== null && data.totalCount !== undefined ? data.totalCount : (data.internalCount || 0) + (data.externalCount || 0));
            setOptions('virtues', data.virtues || []);
            setOptions('sdg', [data.sdg || '']);
            toast('已帶入活動申請內容');
        }
    }

    function setOptions(key, values) {
        root.querySelectorAll('fieldset[data-key="' + key + '"] input').forEach(function (input) { input.checked = values.indexOf(input.value) !== -1; });
    }

    function replaceItems(key, items) {
        var body = root.querySelector('table.forms-items[data-key="' + key + '"] tbody');
        if (!body) return;
        body.innerHTML = '';
        (items.length ? items : [{}]).forEach(function (item) { addRow(key, item); });
    }

    function addEquipment() {
        var select = document.getElementById('forms-equipment');
        var asset = (state.equipment || []).filter(function (item) { return item.id === select.value; })[0];
        if (!asset) return toast('請先選擇設備', true);
        var body = root.querySelector('table.forms-items[data-key="items"] tbody');
        var first = body && body.children.length === 1 ? body.children[0] : null;
        if (first && !first.querySelector('[data-col="name"]').value.trim()) body.innerHTML = '';
        addRow('items', { name: asset.assetName, assetNo: asset.assetNo, quantity: 1, condition: CONDITION_LABELS[asset.condition] || '' });
        select.value = '';
    }

    async function runAi() {
        var textArea = document.getElementById('forms-ai-text');
        var button = document.getElementById('forms-ai-run');
        if (!textArea.value.trim()) return toast('請先輸入白話內容', true);
        button.disabled = true;
        button.textContent = 'AI 產生中…';
        try {
            var response = await fetch('/api/forms/ai-letter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: textArea.value, docType: (root.querySelector('[data-key="docType"]') || {}).value }) });
            var data = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(data.error || 'AI 產生失敗');
            setField('subject', data.subject);
            setField('descriptions', data.descriptions.join('\n'));
            toast('已產生主旨與說明，請確認內容後再儲存');
        } catch (error) {
            toast(error.message, true);
        } finally {
            button.disabled = false;
            button.textContent = 'AI 產生主旨與說明';
        }
    }

    function matchEquipment(name) {
        var target = String(name || '').toLowerCase();
        if (!target || !state.equipment) return null;
        return state.equipment.filter(function (asset) {
            var assetName = String(asset.assetName || '').toLowerCase();
            return asset.status !== 'retired' && assetName && (assetName.indexOf(target) !== -1 || target.indexOf(assetName) !== -1);
        })[0] || null;
    }

    function applyFill(fields) {
        var filled = 0;
        SCHEMAS[state.type].fields.forEach(function (field) {
            var value = fields[field.key];
            if (value === undefined) return;
            filled++;
            if (field.type === 'items') {
                if (state.type === 'equipment-loan') {
                    value = value.map(function (item) {
                        var asset = item.assetNo ? null : matchEquipment(item.name);
                        return asset ? Object.assign({}, item, { name: asset.assetName, assetNo: asset.assetNo, condition: item.condition || CONDITION_LABELS[asset.condition] || '' }) : item;
                    });
                }
                replaceItems(field.key, value);
            } else if (field.type === 'checks') setOptions(field.key, value);
            else if (field.type === 'radios') setOptions(field.key, [value]);
            else if (field.type === 'lines') setField(field.key, value.join('\n'));
            else setField(field.key, typeof value === 'number' ? String(value) : value);
        });
        return filled;
    }

    async function runFill() {
        var textArea = document.getElementById('forms-fill-text');
        var button = document.getElementById('forms-fill-run');
        var notes = document.getElementById('forms-fill-notes');
        if (!textArea.value.trim()) return toast('請先描述要填寫的內容', true);
        button.disabled = true;
        button.textContent = 'AI 填寫中…';
        notes.textContent = '';
        try {
            if (state.type === 'equipment-loan' && IS_OFFICER && state.equipment === null) {
                try { state.equipment = await getJson('/api/equipment'); } catch (error) { state.equipment = []; }
            }
            var response = await fetch('/api/forms/ai-fill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: state.type, text: textArea.value }) });
            var data = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(data.error || 'AI 填寫失敗');
            var count = applyFill(data.fields || {});
            notes.textContent = data.notes || '';
            toast(count ? 'AI 已填入 ' + count + ' 個欄位，請檢查後再儲存' : 'AI 沒有找到可填入的資料', !count);
        } catch (error) {
            toast(error.message, true);
        } finally {
            button.disabled = false;
            button.textContent = 'AI 幫我填';
        }
    }

    // ───────────── collect & save ─────────────

    function collect() {
        var data = {};
        SCHEMAS[state.type].fields.forEach(function (field) {
            if (field.type === 'items') {
                data[field.key] = [];
                root.querySelectorAll('table.forms-items[data-key="' + field.key + '"] tbody tr').forEach(function (row) {
                    var item = {}, filled = false;
                    field.columns.forEach(function (column) {
                        var raw = row.querySelector('[data-col="' + column.key + '"]').value.trim();
                        if (raw && column.key !== 'quantity' && column.key !== 'condition') filled = true;
                        item[column.key] = column.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
                    });
                    if (filled) data[field.key].push(item);
                });
                return;
            }
            if (field.type === 'checks') {
                data[field.key] = Array.prototype.map.call(root.querySelectorAll('fieldset[data-key="' + field.key + '"] input:checked'), function (input) { return input.value; });
                return;
            }
            if (field.type === 'radios') {
                var picked = root.querySelector('fieldset[data-key="' + field.key + '"] input:checked');
                data[field.key] = picked ? picked.value : '';
                return;
            }
            var input = root.querySelector('#forms-fields [data-key="' + field.key + '"]');
            if (!input) return;
            if (field.type === 'checkbox') data[field.key] = input.checked;
            else if (field.type === 'number' && field.key !== 'semester') data[field.key] = input.value === '' ? '' : Number(input.value);
            else if (field.key === 'semester') data[field.key] = Number(input.value);
            else if (field.type === 'lines') data[field.key] = input.value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
            else data[field.key] = input.value;
        });
        return data;
    }

    function rememberProfile(data) {
        var profile = readProfile();
        Object.keys(PROFILE_MAP).forEach(function (key) {
            if (typeof data[key] === 'string' && data[key].trim()) profile[PROFILE_MAP[key]] = data[key].trim();
        });
        writeProfile(profile);
    }

    async function save(print) {
        var form = document.getElementById('forms-editor');
        if (!form.reportValidity()) return;
        var data = collect();
        // Open the print tab synchronously so pop-up blockers allow it.
        var printWindow = print ? window.open('about:blank', '_blank') : null;
        try {
            var response = await fetch(state.editingId ? '/api/forms/' + encodeURIComponent(state.editingId) : '/api/forms', {
                method: state.editingId ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(state.editingId ? { data: data } : { type: state.type, data: data })
            });
            var record = await response.json().catch(function () { return {}; });
            if (!response.ok) throw new Error(record.error || '儲存失敗');
            rememberProfile(data);
            toast((state.editingId ? '已更新 ' : '已建立 ') + record.number);
            if (printWindow) printWindow.location.href = '/admin/forms/print/' + encodeURIComponent(record.id);
            state.editingId = '';
            await loadRecords();
            renderEditor(defaults(state.type));
        } catch (error) {
            if (printWindow) printWindow.close();
            toast(error.message, true);
        }
    }

    // ───────────── history ─────────────

    async function loadRecords() {
        var body = document.getElementById('forms-records');
        try {
            state.records = await getJson('/api/forms');
        } catch (error) {
            body.innerHTML = '<tr><td colspan="6">' + esc(error.message) + '</td></tr>';
            return;
        }
        renderRecords();
        loadPickers();
    }

    function renderRecords() {
        var filter = document.getElementById('forms-filter').value;
        var rows = state.records.filter(function (record) { return !filter || record.type === filter; });
        document.getElementById('forms-records').innerHTML = rows.map(function (record) {
            var external = record.source === 'public';
            var mine = ROLE === 'president' || (external ? IS_OFFICER : record.createdBy === USERNAME);
            var author = external ? '<span class="forms-badge">外部填寫</span><br><small>' + esc(record.data.borrower) + '（' + esc(record.data.studentId) + '）</small>' : esc(record.createdBy);
            return '<tr><td><b>' + esc(record.number) + '</b></td><td>' + esc(SCHEMAS[record.type] ? SCHEMAS[record.type].label : record.type) + '</td><td>' + esc(record.title) + '</td><td>' + author + '</td><td>' + esc(String(record.updatedAt || record.createdAt).slice(0, 10)) + '</td><td class="forms-actions">' +
                '<a class="btn btn-primary" href="/admin/forms/print/' + encodeURIComponent(record.id) + '" target="_blank" rel="noopener">列印</a> ' +
                '<button type="button" class="btn btn-secondary" data-copy="' + esc(record.id) + '">複製</button> ' +
                (mine ? '<button type="button" class="btn btn-secondary" data-edit="' + esc(record.id) + '">編輯</button> <button type="button" class="btn btn-danger" data-delete="' + esc(record.id) + '">刪除</button>' : '') +
                '</td></tr>';
        }).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--text-muted)">尚無表單紀錄。</td></tr>';
    }

    function openRecord(id, asCopy) {
        var record = state.records.filter(function (item) { return item.id === id; })[0];
        if (!record) return;
        state.type = record.type;
        state.editingId = asCopy ? '' : record.id;
        var data = JSON.parse(JSON.stringify(record.data));
        if (asCopy) SCHEMAS[record.type].fields.forEach(function (field) { if (field.today) data[field.key] = today(); });
        renderEditor(data);
        document.getElementById('forms-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function deleteRecord(id) {
        var record = state.records.filter(function (item) { return item.id === id; })[0];
        if (!record || !window.confirm('確定刪除 ' + record.number + '？已列印的紙本不受影響。')) return;
        var response = await fetch('/api/forms/' + encodeURIComponent(id), { method: 'DELETE' });
        var data = await response.json().catch(function () { return {}; });
        toast(response.ok ? '表單已刪除' : (data.error || '刪除失敗'), !response.ok);
        if (response.ok) {
            if (state.editingId === id) { state.editingId = ''; renderEditor(defaults(state.type)); }
            loadRecords();
        }
    }

    // ───────────── settings (president) ─────────────

    async function loadSettings() {
        var settings;
        try { settings = await getJson('/api/forms/settings'); } catch (error) { return; }
        var hadAi = Boolean(state.ai);
        state.ai = settings.ai || null;
        var status = document.getElementById('forms-ai-status');
        if (status) status.textContent = state.ai ? 'AI 已啟用：' + (state.ai.provider === 'groq' ? 'Groq' : 'Gemini') + '（' + state.ai.model + '）' : 'AI 未啟用：請在 Cloudflare Worker 設定 GROQ_API_KEY';
        if (hadAi !== Boolean(state.ai) && !state.editingId) renderEditor(Object.assign(defaults(state.type), collect()));
        var form = document.getElementById('forms-settings');
        if (!form) return;
        Object.keys(settings).forEach(function (key) { var input = form.querySelector('[name="' + key + '"]'); if (input && typeof settings[key] === 'string') input.value = settings[key]; });
    }

    async function saveSettings(event) {
        event.preventDefault();
        var body = {};
        Array.prototype.forEach.call(event.target.querySelectorAll('[name]'), function (input) { body[input.name] = input.value; });
        var response = await fetch('/api/forms/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        var data = await response.json().catch(function () { return {}; });
        toast(response.ok ? '表單設定已儲存' : (data.error || '儲存失敗'), !response.ok);
    }

    // ───────────── events ─────────────

    root.addEventListener('click', function (event) {
        var target = event.target.closest('button, a');
        if (!target || !root.contains(target)) return;
        if (target.classList.contains('forms-type-tab')) {
            state.type = target.dataset.type;
            state.editingId = '';
            renderEditor(defaults(state.type));
        } else if (target.dataset.addRow) addRow(target.dataset.addRow);
        else if (target.hasAttribute('data-remove-row')) {
            var body = target.closest('tbody');
            target.closest('tr').remove();
            if (!body.children.length) addRow(body.closest('table').dataset.key);
            updateTotal();
        } else if (target.id === 'forms-equipment-add') addEquipment();
        else if (target.id === 'forms-ai-run') runAi();
        else if (target.id === 'forms-fill-run') runFill();
        else if (target.id === 'forms-save-print') save(true);
        else if (target.id === 'forms-save') save(false);
        else if (target.id === 'forms-reset' || target.id === 'forms-cancel-edit') { state.editingId = ''; renderEditor(defaults(state.type)); }
        else if (target.dataset.edit) openRecord(target.dataset.edit, false);
        else if (target.dataset.copy) openRecord(target.dataset.copy, true);
        else if (target.dataset.delete) deleteRecord(target.dataset.delete);
    });
    root.addEventListener('input', function (event) { if (event.target.closest('table.forms-items')) updateTotal(); });
    root.addEventListener('change', function (event) {
        if (event.target.id === 'forms-source' && event.target.value) fillFromSource(event.target.value);
        if (event.target.id === 'forms-member' && event.target.value) fillFromMember(event.target.value);
        if (event.target.id === 'forms-filter') renderRecords();
    });
    document.getElementById('forms-editor').addEventListener('submit', function (event) { event.preventDefault(); save(true); });
    var settingsForm = document.getElementById('forms-settings');
    if (settingsForm) settingsForm.addEventListener('submit', saveSettings);

    renderEditor(defaults(state.type));
    loadSettings();
    // Opening the tab refreshes the member and equipment lists used for auto-fill.
    window.loadForms = function () { state.members = null; state.equipment = null; loadRecords(); loadSettings(); };
})();
