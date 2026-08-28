/**
 * ZENQOR TECHNOLOGIES - ENTERPRISE CORE SCRIPT
 * Dynamic Navigation, UI Animations, Translations, and Live CMS Content
 *
 * CHANGES IN THIS VERSION (see accompanying summary for full audit):
 *  - Firestore `content/site_text` now merges into the translations table
 *    BEFORE setLanguage() runs, so every element with data-i18n (and now
 *    data-i18n-placeholder) is editable from the admin dashboard's new
 *    "Page Text" section — no per-page HTML changes needed to add a new
 *    editable field, just add the key to the admin's key list.
 *  - data-i18n-placeholder was previously declared on the contact form but
 *    never actually applied — fixed.
 *  - config/company_profile now actually gets read and injected into every
 *    page's footer (registration no., address) and the floating WhatsApp
 *    widget, plus contact.html's primary address/email/phone block.
 *  - config/system_settings.maintenance now actually locks the site when
 *    turned on (previously this admin field did nothing).
 */
(async function() {
    'use strict';

    // Escapes admin-authored CMS text/attribute values before they're
    // interpolated into innerHTML — content/config Firestore docs are only
    // writable by isAdmin() per firestore.rules, but a compromised admin
    // account (or an admin-dashboard bug) shouldn't be able to inject script
    // into every visitor's page.
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // The translations table intentionally ships a handful of keys (hero_title,
    // cookie_text, tos_content, rp_content, etc.) containing hand-authored markup
    // like <br>, <strong>, and <a href="...">. Firestore content/site_text lets an
    // admin override those same keys, at the same trust level, so a blanket
    // escapeHtml() would both break the legitimate markup AND still leave a
    // compromised admin account (or admin-dashboard bug) able to inject arbitrary
    // script via innerHTML. Instead, allowlist-sanitize: keep only the small set
    // of tags/attributes these fields actually use, drop everything else down to
    // plain text, and block unsafe href schemes (javascript:, data:, etc.).
    const RICH_TEXT_ALLOWED_TAGS = new Set(['A', 'BR', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'H2', 'P', 'UL', 'LI']);
    const RICH_TEXT_ALLOWED_ATTRS = { A: ['href'], SPAN: ['class'] };
    const RICH_TEXT_SAFE_HREF = /^(https?:\/\/|mailto:|\/|#|[\w.-]+\.html)/i;
    const POLICY_CONTENT_KEYS = new Set(['tos_content', 'rp_content']);

    // Policy pages begin with a page H1. Their first content heading must
    // therefore be H2, not H4. Normalising here also protects Firestore text
    // overrides from reintroducing the same accessibility error.
    function normalizePolicyHeadingLevels(key, value) {
        if (!POLICY_CONTENT_KEYS.has(key)) return value;
        return String(value == null ? '' : value)
            .replace(/<h4\b[^>]*>/gi, '<h2>')
            .replace(/<\/h4>/gi, '</h2>');
    }

    function sanitizeRichText(html) {
        const template = document.createElement('template');
        template.innerHTML = String(html == null ? '' : html);
        const walk = (parent) => {
            Array.from(parent.childNodes).forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (!RICH_TEXT_ALLOWED_TAGS.has(node.tagName)) {
                        parent.replaceChild(document.createTextNode(node.textContent), node);
                        return;
                    }
                    const allowedAttrs = RICH_TEXT_ALLOWED_ATTRS[node.tagName] || [];
                    Array.from(node.attributes).forEach((attr) => {
                        if (!allowedAttrs.includes(attr.name)) node.removeAttribute(attr.name);
                    });
                    if (node.tagName === 'A') {
                        const href = node.getAttribute('href') || '';
                        if (!RICH_TEXT_SAFE_HREF.test(href)) node.removeAttribute('href');
                        node.setAttribute('rel', 'noopener noreferrer');
                        if (RICH_TEXT_SAFE_HREF.test(href) && /^https?:\/\//i.test(href)) node.setAttribute('target', '_blank');
                    }
                    walk(node);
                } else if (node.nodeType !== Node.TEXT_NODE) {
                    parent.removeChild(node);
                }
            });
        };
        walk(template.content);
        return template.innerHTML;
    }

    // ─────────────────────────────────────────────
    // 0. FIREBASE INIT (shared across all CMS reads)
    // ─────────────────────────────────────────────
    let db = null;
    try {
        const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
        const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
        // Sama projek Firebase dengan firebase-config.js / zenqor-portal (zenqor-portal-a3b2d).
        // Kekal init berasingan di sini (bukan import statik) sebab script.js dimuatkan
        // sebagai classic <script>, bukan type="module", pada setiap halaman.
        const app = initializeApp({
            apiKey: "AIzaSyDgoE8ckbVWqc1j6bHq1u1685_xJp0y09Y",
            authDomain: "zenqor-portal-a3b2d.firebaseapp.com",
            projectId: "zenqor-portal-a3b2d",
            storageBucket: "zenqor-portal-a3b2d.firebasestorage.app",
            messagingSenderId: "1065187936514",
            appId: "1:1065187936514:web:d05089d6668c58bf3e9a1b"
        });
        db = getFirestore(app);
    } catch (e) {
        console.error("Firebase init failed:", e);
    }

    // ─────────────────────────────────────────────
    // 1. MAINTENANCE MODE (config/system_settings.maintenance)
    // ─────────────────────────────────────────────
    const MAINTENANCE_ALLOWLIST = [];
    async function checkMaintenanceMode() {
        if (!db) return;
        const currentPage = window.location.pathname.split("/").pop() || "index.html";
        if (MAINTENANCE_ALLOWLIST.includes(currentPage)) return;

        try {
            const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const snap = await getDoc(doc(db, "config", "system_settings"));
            if (snap.exists() && snap.data().maintenance === "true") {
                document.documentElement.innerHTML = `<body style="background:#050505;color:#fff;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;text-align:center;padding:20px;">
                    <h1 style="margin:0;">We'll be right back</h1>
                    <p style="color:#94A3B8;max-width:400px;">Zenqor Technologies is currently undergoing scheduled maintenance. Please check back shortly.</p>
                </body>`;
            }
        } catch (e) {
            console.warn("Maintenance check failed:", e);
        }
    }
    await checkMaintenanceMode();

    function initRevealAnimations() {
        if ('IntersectionObserver' in window) {
            const revealCallback = (entries, observer) => {
                entries.forEach(entry => {
                    if(entry.isIntersecting) {
                        entry.target.classList.add('active');
                        observer.unobserve(entry.target);
                    }
                });
            };
            const revealObserver = new IntersectionObserver(revealCallback, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });
            document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));
        } else {
            document.querySelectorAll('.reveal').forEach(el => el.classList.add('active'));
        }
    }
    initRevealAnimations();

    const translations = {
        en: {
            nav_home: "Home", nav_services: "Services", nav_portfolio: "Our Work", nav_about: "About", nav_faq: "FAQ", nav_contact: "Contact",
            nav_port_gaming: "Licensing & Permits", nav_port_web: "Our Client",
            nav_return: "Return & Refund Policy", nav_legal: "Legal Notices", nav_data: "Data Policy",
            hero_badge: "Business Consulting & Licensing", hero_title: "Empowering Your Business <br><span class='text-primary'>Through Consulting, Licensing & Digital Systems</span>",
            hero_sub: "Zenqor Technologies provides end-to-end business consulting — company registration, business licensing, and government permit applications for businesses across Malaysia.",
            btn_portfolio: "View Our Work", btn_contact: "Consult With Us",
            stat_1: "Clients Served", stat_2: "Licences & Permits Processed", stat_3: "Years Combined Experience", stat_gov: "Digital Systems", stat_4: "Deployed In-House",

            trust_badge_1: "SSM Registered Entity", trust_badge_2: "10+ Years Combined Experience", trust_badge_3: "100+ Businesses Served", trust_badge_4: "Malaysia-Wide Coverage",
            testimonials_title: "What Our <span class='text-primary'>Clients Say</span>", testimonials_sub: "Real feedback from businesses we've helped register, license, and grow.",
            process_title: "How <span class='text-primary'>We Work</span>", process_sub: "A clear, guided process from first consultation to final handover.",
            process_1_t: "Consultation", process_1_d: "We assess your requirements and advise on the right registration, licensing, or system solution for your business.",
            process_2_t: "Documentation", process_2_d: "We prepare and compile all required forms and supporting documents for your application.",
            process_3_t: "Submission & Follow-up", process_3_d: "We submit your application and liaise directly with the relevant authorities on your behalf.",
            process_4_t: "Approval & Handover", process_4_d: "Once approved, we hand over all official documents and remain available for ongoing support.",
            process_note: "Free initial consultation &middot; Transparent quote before any work begins",
            cookie_text: "We use essential cookies to keep this website working. With your permission, analytics cookies help us understand site traffic. See our <a href=\"data-policy.html\">Data Policy</a> for details.",
            cookie_accept: "Accept analytics", cookie_decline: "Reject", cookie_manage: "Manage preferences",

            about_title: "Your Trusted Partner <span class='text-primary'>in Business Growth</span>",
            about_sub: "We combine regulatory and licensing expertise with in-house technology to help businesses register, get licensed, stay compliant, and operate efficiently — all under one roof.",
            tech_1: "Business Registration", tech_2: "Licensing & Permits", tech_3: "HRMS/CDTS Systems", tech_4: "Compliance Advisory",
            tech_1_li1: "SSM Company Incorporation", tech_1_li2: "Business Structuring", tech_1_li3: "Partnership & Sdn Bhd Setup",
            tech_2_li1: "Government Permit Applications", tech_2_li2: "Business Licence Renewal", tech_2_li3: "Regulatory Submissions",
            tech_3_li1: "Payroll & Employee Management", tech_3_li2: "Client Document Tracking", tech_3_li3: "Project & Billing Automation",
            tech_4_li1: "Regulatory Compliance Review", tech_4_li2: "Data Protection (PDPA) Advisory", tech_4_li3: "Ongoing Renewal Support",
            agencies_title: "Agencies & <span class='text-primary'>Systems We Work With</span>", agencies_sub: "Government bodies and regulatory systems our consulting team engages with every day.",
            about_disclaimer_title: "Independent Consultancy Disclaimer",
            about_disclaimer_text: "Zenqor Technologies is an independent private business consultancy. We are not a government agency and are not affiliated with or endorsed by any government authority. We provide advisory, documentation preparation and application guidance only. Official licences, permits, registrations and approvals are issued solely by the relevant government authorities.",

            srv_main_title: "Our <span class='text-primary'>Consulting & Digital Services</span>",
            srv_main_sub: "From business registration and government licensing to the digital systems that run your operations.",
            srv_1_t: "Business Registration & Company Setup", srv_1_d: "End-to-end assistance with SSM company registration and business structuring for new and growing businesses.",
            srv_2_t: "Licensing & Government Permit Consulting", srv_2_d: "We manage the full application process for business licences and government permits, so you don't have to.",
            srv_3_t: "HRMS/CDTS Digital Systems", srv_3_d: "Our own in-house Human Resource Management & Client Documents Tracking System, built to keep your operations organised.",
            srv_4_t: "Payroll & Document Automation", srv_4_d: "Automated payslip generation, invoicing, and official document workflows tailored to Malaysian compliance requirements.",
            srv_5_t: "Compliance & Regulatory Advisory", srv_5_d: "Ongoing guidance to help your business stay compliant with evolving regulatory and licensing requirements.",
            srv_6_t: "Custom Enterprise Software Development", srv_6_d: "Bespoke digital systems and business automation tools designed around how your business actually operates.",

            con_title: "Start a Conversation", con_sub: "Partner with us for your next business registration, licensing application, or digital system.",
            hq_title: "Headquarters", hq_addr: "Bandar Mahkota Cheras<br>Selangor, Malaysia",
            email_caption: "General Inquiries &amp; Suggestions",
            ph_name: "Name", ph_email: "Email Address", ph_msg: "Message Details", ph_phone: "Phone Number", ph_company: "Company Name (Optional)",
            opt_def: "Select Request Type", opt_1: "Business Registration", opt_2: "Licensing / Government Permit", opt_3: "HRMS/CDTS Digital System", opt_4: "Custom Software Consultation",
            btn_submit: "Send Request", btn_processing: "Processing...",
            contact_chat: "Chat With Us", contact_call: "Call Us Now",
            biz_hours_title: "Business Hours", biz_hours_weekday: "<strong>Mon - Fri:</strong> 8:00 AM - 5:30 PM", biz_hours_weekend: "Sat - Sun: Closed",
            loading_services: "Loading services...", loading_portfolio: "Synchronizing live portfolio data...", error_db: "Error connecting to database.",

            faq_page_title: "Frequently Asked Questions",
            faq_sub: "Find answers to common questions about our consulting and digital services.",
            faq_1_q: "What business registration and licensing services do you offer?", faq_1_a: "We assist with SSM company registration, business licensing, and government permit applications from start to finish. Reach out via the Contact page to discuss your requirements.",
            faq_2_q: "Do you build custom digital systems for businesses?", faq_2_a: "Yes — we design and build custom digital systems, including our own HRMS/CDTS platform for HR management and client document tracking. Please contact us to discuss your needs.",
            faq_3_q: "Is ongoing support included after a project is delivered?", faq_3_a: "Absolutely. All our consulting and digital system engagements come with dedicated after-service support and follow-up.",
            faq_4_q: "How long does business registration or licensing usually take?", faq_4_a: "Timelines vary by application type — SSM company registration is typically completed within a few working days, while government licences and permits depend on the relevant authority's processing time. We'll give you a realistic estimate once we understand your specific requirements.",
            faq_5_q: "Do you only serve businesses in Selangor, or across Malaysia?", faq_5_a: "We're based in Bandar Mahkota Cheras, Selangor, and serve clients across Malaysia. Most of our consulting and digital system work is handled remotely, with on-site meetings arranged when needed.",
            faq_6_q: "How much do your services cost?", faq_6_a: "Pricing depends on the scope of work — a straightforward SSM registration differs greatly from a custom HRMS/CDTS build. Contact us with your requirements and we'll provide a clear, no-obligation quote.",
            faq_7_q: "What is the HRMS/CDTS system, and will our team get access to it?", faq_7_a: "HRMS/CDTS is our in-house Human Resource Management & Client Document Tracking System — it handles payroll, employee management, and client document/project tracking. Clients we build or onboard onto the system receive their own portal login to track progress and documents.",
            faq_8_q: "How do you handle data privacy and PDPA compliance?", faq_8_a: "Client and business data is handled in line with Malaysia's Personal Data Protection Act (PDPA). See our <a href=\"data-policy.html\">Data Policy</a> page for full details on how we collect, store, and protect information.",
            faq_9_q: "How do I get started with Zenqor Technologies?", faq_9_a: "Reach out via the <a href=\"contact.html\">Contact</a> page or WhatsApp with a brief description of what you need — company registration, licensing, or a digital system. We'll respond with next steps and, if needed, schedule a consultation.",

            pg_hero_title: "Licensing & <span class='text-primary'>Permit Consulting</span>",
            pg_hero_sub: "Business licences, government permits, and regulatory applications handled on behalf of our clients.",
            pw_hero_title: "Clients We've Worked With", pw_hero_sub: "A showcase of the businesses and organisations Zenqor Technologies has served — company registration, licensing, and digital systems delivered for real clients across Malaysia.",

            tos_content: "<h4>1. Acceptance of Terms</h4><p>By accessing and using services provided by Zenqor Technologies, you agree to be bound by these Terms of Service.</p><h4>2. Intellectual Property</h4><p>All systems, deliverables, and materials provided remain the intellectual property of Zenqor Technologies until full payment is received, after which a usage license (not ownership of the underlying source) is granted to the client.</p><h4>3. Consultancy & Licensing Services</h4><p>For business registration, licensing, and government permit application services, Zenqor Technologies acts solely as a professional consultant and facilitator. All decisions to approve, reject, defer, or impose additional conditions on an application rest solely with the relevant Local Authority (PBT) or other competent government agency — Zenqor Technologies does not guarantee approval. Zenqor Technologies is not liable for any rejection, processing delay, or loss arising from inaccurate or incomplete client documents, false information, pre-existing legal or regulatory issues affecting the client's premises, the client's own delay, or a failure to meet applicable technical standards.</p><h4>4. Confidentiality</h4><p>Zenqor Technologies keeps all non-public business, technical, and financial information shared by a client confidential, and will not disclose it to a third party without prior written consent, except where required by law or reasonably necessary to carry out the engaged services.</p><h4>5. Dispute Resolution</h4><p>Any dispute, difference in interpretation, or claim arising out of or relating to services provided by Zenqor Technologies will first be addressed through good-faith negotiation for fourteen (14) days after written notice of the dispute.</p><h4>6. Governing Law</h4><p>These Terms and any service agreement with Zenqor Technologies are governed by and construed in accordance with the laws of Malaysia, and the parties submit to the jurisdiction of the courts of Malaysia.</p>",
            rp_content: "<h4>Consulting & Licensing Engagements</h4><p>All service fees paid to Zenqor Technologies are non-refundable once consultancy work, document audit, or application preparation has commenced. This applies whether the engagement is cancelled by the Client for their own reasons, or the relevant Local Authority (PBT) or government agency defers, rejects, or delays the application — Zenqor Technologies acts solely as a professional consultant and facilitator, and does not guarantee approval.</p><h4>Government & Statutory Fees</h4><p>Official government fees — including licence fees, inspection charges, signage charges, deposits, and penalties — are paid directly by the Client to the relevant authority and are separate from Zenqor Technologies' service fees. These amounts are outside our control and are not refundable by Zenqor Technologies.</p><h4>Phased Billing</h4><p>Fees are invoiced in fixed project phases as work progresses. If an engagement is terminated by either party, the Client remains responsible for payment of every phase of work already completed up to the effective termination date.</p><h4>Questions or Disputes</h4><p>If you have a concern about work delivered under your Service Agreement, contact us at <a href='mailto:admin@zenqor.com.my'>admin@zenqor.com.my</a> with your agreement reference and a description of the issue. We will work with you in good faith to resolve it, consistent with the terms of your signed Service Agreement.</p>",

            dp_title: "Privacy & Data Protection",
            dp_desc1: "At Zenqor Technologies, system security and user privacy are our top priorities. We are committed to protecting the personal and business data you provide us in accordance with applicable data protection regulations.",
            dp_desc2: "We collect only essential information required to deliver our consulting, licensing, and digital system services. With your consent, we also use Google Analytics to understand aggregate site traffic and improve the website. You can accept, reject, or change this choice at any time through Cookie Settings. We do not sell or share your personal data with unauthorized third parties. For any vulnerability reports or data deletion requests, please contact us directly at admin@zenqor.com.my.",

            footer_copy: "© 2026 Zenqor Technologies (Malaysia). All rights reserved.",

            why_badge: "Why Choose Us",
            why_title: "Your Malaysia Business Partner — <span class='text-primary'>Not Just a Service Provider</span>",
            why_sub: "We understand the real challenges foreign entrepreneurs face — and Zenqor Technologies eliminates every one of them.",
            why_1_t: "End-to-End Business Registration & Licensing",
            why_1_d: "From SSM company incorporation and business structuring to government licences and permit applications — Zenqor Technologies manages the entire registration journey under one roof.",
            why_1_li1: "SSM company incorporation", why_1_li2: "Business licence & permit applications", why_1_li3: "One team, one point of contact",
            why_2_t: "Direct Government & Regulatory Liaison",
            why_2_d: "Zenqor Technologies works hand-in-hand with the government departments and regulators your business actually needs, including:",
            why_2_note: "Real filing experience that keeps your submissions moving.",
            why_2_li1: "We know the processes well", why_2_li2: "Faster, smoother submissions", why_2_li3: "Fewer rejected applications",
            why_3_t: "Our Own In-House HRMS/CDTS Digital Systems",
            why_3_d: "We don't just consult — we build. Our HRMS/CDTS platform runs Zenqor Technologies' own operations every day, and the same battle-tested system is available to power yours.",
            why_3_tag1: "Payroll Automation", why_3_tag2: "Employee Management", why_3_tag3: "Client Document Tracking", why_3_tag4: "Project & Billing Automation",
            why_3_note: "Built and proven in-house before it's ever offered to a client.",
            why_3_li1: "Payroll & employee management", why_3_li2: "Client document tracking", why_3_li3: "Project & billing automation",
            why_4_t: "Compliance-First, Long-Term Support",
            why_4_d: "Beyond the initial registration or licence, Zenqor Technologies stays with you — regulatory compliance reviews, PDPA advisory, and renewal support for the life of your business.",
            why_4_li1: "Regulatory compliance reviews", why_4_li2: "PDPA data protection advisory", why_4_li3: "Ongoing renewal support"
        },
        ms: {
            nav_home: "Utama", nav_services: "Perkhidmatan", nav_portfolio: "Kerja Kami", nav_about: "Tentang Kami", nav_faq: "FAQ", nav_contact: "Hubungi",
            nav_port_gaming: "Lesen & Permit", nav_port_web: "Klien Kami",
            nav_return: "Polisi Pemulangan & Bayaran Balik", nav_legal: "Notis Undang-Undang", nav_data: "Polisi Data",
            hero_badge: "Perundingan Perniagaan & Perlesenan", hero_title: "Memperkasa Perniagaan Anda <br><span class='text-primary'>Melalui Perundingan, Perlesenan & Sistem Digital</span>",
            hero_sub: "Zenqor Technologies menyediakan perundingan perniagaan menyeluruh — pendaftaran syarikat, perlesenan perniagaan, dan permohonan permit kerajaan untuk perniagaan di seluruh Malaysia.",
            btn_portfolio: "Lihat Kerja Kami", btn_contact: "Berunding Dengan Kami",
            stat_1: "Klien Dilayan", stat_2: "Lesen & Permit Diproses", stat_3: "Tahun Pengalaman Gabungan", stat_gov: "Sistem Digital", stat_4: "Dibangunkan Sendiri",

            trust_badge_1: "Entiti Berdaftar SSM", trust_badge_2: "10+ Tahun Pengalaman Gabungan", trust_badge_3: "100+ Perniagaan Dilayan", trust_badge_4: "Liputan Seluruh Malaysia",
            testimonials_title: "Apa Kata <span class='text-primary'>Klien Kami</span>", testimonials_sub: "Maklum balas sebenar daripada perniagaan yang telah kami bantu mendaftar, mendapatkan lesen, dan berkembang.",
            process_title: "Cara <span class='text-primary'>Kami Bekerja</span>", process_sub: "Proses yang jelas dan berpandu dari perundingan pertama sehingga penyerahan akhir.",
            process_1_t: "Perundingan", process_1_d: "Kami menilai keperluan anda serta menasihati dan mencadangkan penyelesaian pendaftaran, perlesenan, atau sistem yang sesuai untuk perniagaan anda.",
            process_2_t: "Dokumentasi", process_2_d: "Kami menyediakan dan menyusun semua borang serta dokumen sokongan yang diperlukan untuk permohonan anda.",
            process_3_t: "Penghantaran & Susulan", process_3_d: "Kami menghantar permohonan anda dan berhubung terus dengan pihak berkuasa berkaitan bagi pihak anda.",
            process_4_t: "Kelulusan & Penyerahan", process_4_d: "Setelah diluluskan, kami menyerahkan semua dokumen rasmi dan sedia membantu untuk sokongan berterusan.",
            process_note: "Perundingan awal percuma &middot; Sebutharga telus sebelum sebarang kerja bermula",
            cookie_text: "Kami menggunakan kuki penting untuk memastikan laman ini berfungsi. Dengan kebenaran anda, kuki analitik membantu kami memahami trafik laman. Lihat <a href=\"data-policy.html\">Polisi Data</a> kami untuk maklumat lanjut.",
            cookie_accept: "Terima analitik", cookie_decline: "Tolak", cookie_manage: "Urus pilihan",

            about_title: "Rakan Kongsi Dipercayai <span class='text-primary'>Dalam Pertumbuhan Perniagaan</span>",
            about_sub: "Kami menggabungkan kepakaran regulatori dan perlesenan dengan teknologi dalaman untuk membantu perniagaan mendaftar, mendapat lesen, kekal patuh, dan beroperasi dengan cekap — semuanya di bawah satu bumbung.",
            tech_1: "Pendaftaran Perniagaan", tech_2: "Lesen & Permit", tech_3: "Sistem HRMS/CDTS", tech_4: "Nasihat Pematuhan",
            tech_1_li1: "Penubuhan Syarikat SSM", tech_1_li2: "Penstrukturan Perniagaan", tech_1_li3: "Penubuhan Perkongsian & Sdn Bhd",
            tech_2_li1: "Permohonan Permit Kerajaan", tech_2_li2: "Pembaharuan Lesen Perniagaan", tech_2_li3: "Penyerahan Regulatori",
            tech_3_li1: "Pengurusan Gaji & Pekerja", tech_3_li2: "Penjejakan Dokumen Klien", tech_3_li3: "Automasi Projek & Bil",
            tech_4_li1: "Semakan Pematuhan Regulatori", tech_4_li2: "Nasihat Perlindungan Data (PDPA)", tech_4_li3: "Sokongan Pembaharuan Berterusan",
            agencies_title: "Agensi & <span class='text-primary'>Sistem Yang Kami Uruskan</span>", agencies_sub: "Badan kerajaan dan sistem regulatori yang pasukan perundingan kami uruskan setiap hari.",
            about_disclaimer_title: "Penafian Perundingan Bebas",
            about_disclaimer_text: "Zenqor Technologies ialah sebuah firma perundingan perniagaan swasta yang bebas. Kami bukan agensi kerajaan dan tidak bergabung dengan atau disokong oleh mana-mana pihak berkuasa kerajaan. Kami hanya menyediakan khidmat nasihat, penyediaan dokumentasi dan panduan permohonan sahaja. Lesen, permit, pendaftaran dan kelulusan rasmi hanya dikeluarkan oleh pihak berkuasa kerajaan yang berkaitan.",

            srv_main_title: "Perundingan & <span class='text-primary'>Perkhidmatan Digital Kami</span>",
            srv_main_sub: "Dari pendaftaran perniagaan dan perlesenan kerajaan sehingga sistem digital yang menggerakkan operasi anda.",
            srv_1_t: "Pendaftaran Perniagaan & Penubuhan Syarikat", srv_1_d: "Bantuan menyeluruh untuk pendaftaran syarikat SSM dan penstrukturan perniagaan untuk syarikat baharu dan sedang berkembang.",
            srv_2_t: "Perundingan Lesen & Permit Kerajaan", srv_2_d: "Kami menguruskan keseluruhan proses permohonan lesen perniagaan dan permit kerajaan bagi pihak anda.",
            srv_3_t: "Sistem Digital HRMS/CDTS", srv_3_d: "Sistem Pengurusan Sumber Manusia & Penjejakan Dokumen Klien dalaman kami sendiri, dibina untuk memastikan operasi anda tersusun.",
            srv_4_t: "Automasi Payroll & Dokumen", srv_4_d: "Penjanaan slip gaji, invois, dan aliran kerja dokumen rasmi automatik yang disesuaikan dengan keperluan pematuhan Malaysia.",
            srv_5_t: "Nasihat Pematuhan & Regulatori", srv_5_d: "Panduan berterusan untuk membantu perniagaan anda kekal patuh dengan keperluan regulatori dan perlesenan yang sentiasa berkembang.",
            srv_6_t: "Pembangunan Perisian Perusahaan Tersuai", srv_6_d: "Sistem digital dan alatan automasi perniagaan tersuai direka bentuk mengikut cara perniagaan anda beroperasi.",

            con_title: "Mulakan Perbualan", con_sub: "Bekerjasama dengan kami untuk pendaftaran perniagaan, permohonan lesen, atau sistem digital seterusnya.",
            hq_title: "Ibu Pejabat", hq_addr: "Bandar Mahkota Cheras<br>Selangor, Malaysia",
            email_caption: "Pertanyaan Am &amp; Cadangan",
            ph_name: "Nama", ph_email: "Alamat Emel", ph_msg: "Butiran Mesej", ph_phone: "Nombor Telefon", ph_company: "Nama Syarikat (Pilihan)",
            opt_def: "Pilih Jenis Permintaan", opt_1: "Pendaftaran Perniagaan", opt_2: "Lesen / Permit Kerajaan", opt_3: "Sistem Digital HRMS/CDTS", opt_4: "Perundingan Perisian Tersuai",
            btn_submit: "Hantar Permintaan", btn_processing: "Sedang Diproses...",
            contact_chat: "Chat Dengan Kami", contact_call: "Hubungi Kami Sekarang",
            biz_hours_title: "Waktu Operasi", biz_hours_weekday: "<strong>Isnin - Jumaat:</strong> 8:00 PG - 5:30 PTG", biz_hours_weekend: "Sabtu - Ahad: Tutup",
            loading_services: "Memuatkan perkhidmatan...", loading_portfolio: "Menyegerakkan data portfolio langsung...", error_db: "Ralat menyambung ke pangkalan data.",

            faq_page_title: "Soalan Lazim",
            faq_sub: "Cari jawapan kepada soalan lazim tentang perkhidmatan perundingan dan digital kami.",
            faq_1_q: "Apakah perkhidmatan pendaftaran perniagaan dan perlesenan yang anda tawarkan?", faq_1_a: "Kami membantu pendaftaran syarikat SSM, perlesenan perniagaan, dan permohonan permit kerajaan dari awal hingga selesai. Hubungi kami melalui halaman Hubungi untuk membincangkan keperluan anda.",
            faq_2_q: "Adakah anda membina sistem digital tersuai untuk perniagaan?", faq_2_a: "Ya — kami mereka bentuk dan membina sistem digital tersuai, termasuk platform HRMS/CDTS kami sendiri untuk pengurusan sumber manusia dan penjejakan dokumen klien. Sila hubungi kami untuk membincangkan keperluan anda.",
            faq_3_q: "Adakah sokongan berterusan disertakan selepas projek disiapkan?", faq_3_a: "Sudah tentu. Semua penglibatan perundingan dan sistem digital kami disertakan sokongan susulan khusus.",
            faq_4_q: "Berapa lama proses pendaftaran perniagaan atau perlesenan biasanya mengambil masa?", faq_4_a: "Tempoh berbeza mengikut jenis permohonan — pendaftaran syarikat SSM biasanya siap dalam beberapa hari bekerja, manakala lesen dan permit kerajaan bergantung kepada tempoh pemprosesan pihak berkuasa berkaitan. Kami akan berikan anggaran yang realistik selepas memahami keperluan khusus anda.",
            faq_5_q: "Adakah anda hanya berkhidmat untuk perniagaan di Selangor, atau di seluruh Malaysia?", faq_5_a: "Kami berpangkalan di Bandar Mahkota Cheras, Selangor, dan berkhidmat untuk klien di seluruh Malaysia. Kebanyakan kerja perundingan dan sistem digital kami dijalankan secara jarak jauh, dengan pertemuan bersemuka diatur mengikut keperluan.",
            faq_6_q: "Berapakah kos perkhidmatan anda?", faq_6_a: "Harga bergantung kepada skop kerja — pendaftaran SSM yang mudah amat berbeza daripada pembangunan HRMS/CDTS tersuai. Hubungi kami dengan keperluan anda dan kami akan berikan sebut harga yang jelas tanpa sebarang obligasi.",
            faq_7_q: "Apakah sistem HRMS/CDTS, dan adakah pasukan kami akan mendapat akses kepadanya?", faq_7_a: "HRMS/CDTS ialah Sistem Pengurusan Sumber Manusia & Penjejakan Dokumen Klien dalaman kami — ia menguruskan payroll, pengurusan pekerja, dan penjejakan dokumen/projek klien. Klien yang dibina atau didaftarkan ke dalam sistem akan menerima log masuk portal mereka sendiri untuk menjejak kemajuan dan dokumen.",
            faq_8_q: "Bagaimana anda menguruskan privasi data dan pematuhan PDPA?", faq_8_a: "Data klien dan perniagaan diuruskan selaras dengan Akta Perlindungan Data Peribadi (PDPA) Malaysia. Lihat halaman <a href=\"data-policy.html\">Dasar Data</a> kami untuk butiran lengkap tentang cara kami mengumpul, menyimpan, dan melindungi maklumat.",
            faq_9_q: "Bagaimana saya boleh mula bekerjasama dengan Zenqor Technologies?", faq_9_a: "Hubungi kami melalui halaman <a href=\"contact.html\">Hubungi</a> atau WhatsApp dengan penerangan ringkas tentang keperluan anda — pendaftaran syarikat, perlesenan, atau sistem digital. Kami akan membalas dengan langkah seterusnya dan menjadualkan konsultasi jika perlu.",

            pg_hero_title: "Perundingan <span class='text-primary'>Lesen & Permit</span>",
            pg_hero_sub: "Lesen perniagaan, permit kerajaan, dan permohonan regulatori yang diuruskan bagi pihak klien kami.",
            pw_hero_title: "Klien Yang Pernah Kami Bantu", pw_hero_sub: "Pameran perniagaan dan organisasi yang pernah dibantu oleh Zenqor Technologies — pendaftaran syarikat, perlesenan, dan sistem digital yang dihasilkan untuk klien sebenar di seluruh Malaysia.",

            tos_content: "<h4>1. Penerimaan Terma</h4><p>Dengan mengakses dan menggunakan perkhidmatan yang disediakan oleh Zenqor Technologies, anda bersetuju untuk terikat dengan Terma Perkhidmatan ini.</p><h4>2. Hak Harta Intelek</h4><p>Semua sistem, deliverables, dan bahan yang disediakan kekal sebagai hak harta intelek Zenqor Technologies sehingga bayaran penuh diterima, selepas itu lesen penggunaan (bukan pemilikan kod sumber) diberikan kepada pelanggan.</p><h4>3. Perkhidmatan Perundingan & Perlesenan</h4><p>Bagi perkhidmatan pendaftaran perniagaan, perlesenan, dan permohonan permit kerajaan, Zenqor Technologies bertindak semata-mata sebagai perunding profesional dan fasilitator. Semua keputusan untuk meluluskan, menolak, menangguhkan atau mengenakan syarat tambahan terhadap sesuatu permohonan terletak sepenuhnya pada Pihak Berkuasa Tempatan (PBT) atau agensi kerajaan berwajib yang lain — Zenqor Technologies tidak menjamin kelulusan. Zenqor Technologies tidak bertanggungjawab terhadap sebarang penolakan, kelewatan pemprosesan atau kerugian yang berpunca daripada dokumen pelanggan yang tidak tepat atau tidak lengkap, maklumat palsu, isu undang-undang atau kawal selia sedia ada yang menjejaskan premis pelanggan, kelewatan oleh pelanggan sendiri, atau kegagalan memenuhi piawaian teknikal yang berkenaan.</p><h4>4. Kerahsiaan</h4><p>Zenqor Technologies merahsiakan semua maklumat perniagaan, teknikal dan kewangan bukan awam yang dikongsi oleh pelanggan, dan tidak akan mendedahkannya kepada pihak ketiga tanpa persetujuan bertulis terlebih dahulu, kecuali jika diwajibkan oleh undang-undang atau semunasabahnya diperlukan untuk melaksanakan perkhidmatan yang dilibatkan.</p><h4>5. Penyelesaian Pertikaian</h4><p>Sebarang pertikaian, perbezaan tafsiran atau tuntutan yang timbul daripada atau berkaitan dengan perkhidmatan yang disediakan oleh Zenqor Technologies akan diselesaikan terlebih dahulu melalui rundingan dengan niat baik selama empat belas (14) hari selepas notis bertulis mengenai pertikaian diberikan.</p><h4>6. Undang-Undang yang Mengawal</h4><p>Terma ini dan mana-mana perjanjian perkhidmatan dengan Zenqor Technologies ditadbir dan ditafsirkan mengikut undang-undang Malaysia, dan pihak-pihak bersetuju untuk tertakluk pada bidang kuasa mahkamah Malaysia.</p>",
            rp_content: "<h4>Penglibatan Perundingan & Perlesenan</h4><p>Semua fi perkhidmatan yang dibayar kepada Zenqor Technologies tidak boleh dikembalikan sebaik sahaja kerja perundingan, audit dokumen, atau penyediaan permohonan dimulakan. Ini terpakai sama ada penglibatan dibatalkan oleh Pelanggan atas sebabnya sendiri, atau Pihak Berkuasa Tempatan (PBT) atau agensi kerajaan berkaitan menangguhkan, menolak atau melewatkan permohonan — Zenqor Technologies bertindak semata-mata sebagai perunding profesional dan fasilitator, dan tidak menjamin kelulusan.</p><h4>Fi Kerajaan & Statutori</h4><p>Fi rasmi kerajaan — termasuk fi lesen, caj pemeriksaan, caj papan tanda, deposit dan penalti — dibayar terus oleh Pelanggan kepada pihak berkuasa berkaitan dan adalah berasingan daripada fi perkhidmatan Zenqor Technologies. Amaun ini di luar kawalan kami dan tidak boleh dikembalikan oleh Zenqor Technologies.</p><h4>Pembayaran Berfasa</h4><p>Fi dikenakan invois mengikut fasa projek tetap semasa kerja berjalan. Sekiranya penglibatan ditamatkan oleh mana-mana pihak, Pelanggan tetap bertanggungjawab membayar setiap fasa kerja yang telah diselesaikan sebelum tarikh kuat kuasa penamatan.</p><h4>Soalan atau Pertikaian</h4><p>Jika anda mempunyai kebimbangan mengenai kerja yang dihantar di bawah Perjanjian Perkhidmatan anda, hubungi kami di <a href='mailto:admin@zenqor.com.my'>admin@zenqor.com.my</a> dengan rujukan perjanjian anda dan penerangan isu. Kami akan berusaha menyelesaikannya dengan niat baik, selaras dengan terma Perjanjian Perkhidmatan yang telah anda tandatangani.</p>",

            dp_title: "Privasi & Perlindungan Data",
            dp_desc1: "Di Zenqor Technologies, keselamatan sistem dan privasi pengguna adalah keutamaan utama kami. Kami komited untuk melindungi data peribadi dan perniagaan yang anda berikan mengikut peraturan perlindungan data yang berkuat kuasa.",
            dp_desc2: "Kami hanya mengumpul maklumat penting yang diperlukan untuk menyampaikan perkhidmatan perundingan, perlesenan, dan sistem digital kami. Dengan kebenaran anda, kami turut menggunakan Google Analytics untuk memahami trafik laman secara agregat dan menambah baik laman web. Anda boleh menerima, menolak, atau menukar pilihan ini pada bila-bila masa melalui Tetapan Kuki. Kami tidak menjual atau berkongsi data peribadi anda dengan pihak ketiga yang tidak dibenarkan. Untuk laporan kelemahan atau permintaan pemadaman data, sila hubungi kami terus di admin@zenqor.com.my.",

            footer_copy: "© 2026 Zenqor Technologies (Malaysia). Hak cipta terpelihara.",

            why_badge: "Kenapa Pilih Kami",
            why_title: "Rakan Perniagaan Malaysia Anda — <span class='text-primary'>Bukan Sekadar Penyedia Perkhidmatan</span>",
            why_sub: "Kami memahami cabaran sebenar yang dihadapi usahawan asing — dan Zenqor Technologies menghapuskan setiap satu daripadanya.",
            why_1_t: "Pendaftaran & Perlesenan Perniagaan Hujung-ke-Hujung",
            why_1_d: "Daripada penubuhan syarikat SSM dan penstrukturan perniagaan sehingga lesen kerajaan dan permohonan permit — Zenqor Technologies menguruskan keseluruhan perjalanan pendaftaran anda di bawah satu bumbung.",
            why_1_li1: "Penubuhan syarikat SSM", why_1_li2: "Permohonan lesen & permit perniagaan", why_1_li3: "Satu pasukan, satu titik hubungan",
            why_2_t: "Perhubungan Kerajaan & Regulatori Secara Terus",
            why_2_d: "Zenqor Technologies bekerjasama rapat dengan jabatan kerajaan dan pihak berkuasa yang benar-benar diperlukan perniagaan anda, termasuk:",
            why_2_note: "Pengalaman pemfailan sebenar yang memastikan permohonan anda terus bergerak.",
            why_2_li1: "Kami memahami prosesnya dengan baik", why_2_li2: "Penyerahan lebih pantas dan lancar", why_2_li3: "Permohonan lebih jarang ditolak",
            why_3_t: "Sistem Digital HRMS/CDTS Milik Kami Sendiri",
            why_3_d: "Kami bukan sekadar menasihati — kami membina. Platform HRMS/CDTS kami menggerakkan operasi Zenqor Technologies sendiri setiap hari, dan sistem yang telah terbukti ini turut tersedia untuk menggerakkan perniagaan anda.",
            why_3_tag1: "Automasi Gaji", why_3_tag2: "Pengurusan Pekerja", why_3_tag3: "Penjejakan Dokumen Klien", why_3_tag4: "Automasi Projek & Bil",
            why_3_note: "Dibina dan dibuktikan secara dalaman sebelum ditawarkan kepada klien.",
            why_3_li1: "Pengurusan gaji & pekerja", why_3_li2: "Penjejakan dokumen klien", why_3_li3: "Automasi projek & bil",
            why_4_t: "Mengutamakan Pematuhan, Sokongan Jangka Panjang",
            why_4_d: "Selepas pendaftaran atau lesen awal, Zenqor Technologies terus bersama anda — semakan pematuhan regulatori, nasihat PDPA, dan sokongan pembaharuan sepanjang perniagaan anda beroperasi.",
            why_4_li1: "Semakan pematuhan regulatori", why_4_li2: "Nasihat perlindungan data PDPA", why_4_li3: "Sokongan pembaharuan berterusan"
        }
    };

    async function applyContentOverrides() {
        if (!db) return;
        try {
            const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const snap = await getDoc(doc(db, "content", "site_text"));
            if (!snap.exists()) return;
            const overrides = snap.data();
            Object.keys(overrides).forEach((key) => {
                const val = overrides[key];
                if (val && typeof val === "object") {
                    if (val.en) translations.en[key] = val.en;
                    if (val.ms) translations.ms[key] = val.ms;
                }
            });
        } catch (e) {
            console.warn("Content override fetch failed, using defaults:", e);
        }
    }

    let currentLang = localStorage.getItem('zenqor-lang') || 'en';
    function setLanguage(lang) {
        currentLang = lang;
        localStorage.setItem('zenqor-lang', lang);
        document.documentElement.lang = lang;
        const langToggleBtn = document.getElementById('lang-toggle');
        if(langToggleBtn) langToggleBtn.textContent = lang === 'en' ? 'MS' : 'EN';

        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if(translations[lang] && translations[lang][key]) el.innerHTML = sanitizeRichText(normalizePolicyHeadingLevels(key, translations[lang][key]));
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if(translations[lang] && translations[lang][key]) el.setAttribute('placeholder', translations[lang][key]);
        });

        // Lets page-specific scripts (e.g. Services/Portfolio card renderers that
        // pull bilingual fallback data) re-render their own dynamic content
        // whenever the language toggle changes, without this file needing to
        // know about every page's DOM structure.
        document.dispatchEvent(new CustomEvent('zenqor:langchange', { detail: { lang } }));
    }

    // Apply the saved language before waiting for remote CMS content. This
    // prevents the header from first painting in one language and then moving
    // when the saved language is applied after network requests finish.
    setLanguage(currentLang);

    async function applyCompanyProfile() {
        if (!db) return;
        try {
            const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const snap = await getDoc(doc(db, "config", "company_profile"));
            if (!snap.exists()) return;
            const c = snap.data();

            const regEl = document.getElementById('footRegNo');
            if (regEl && c.regNo) regEl.textContent = `No. Pendaftaran: ${c.regNo}`;

            const addrEls = document.querySelectorAll('#footAddress, #contactAddress');
            addrEls.forEach(el => { if (c.address) el.innerHTML = escapeHtml(c.address).replace(/\n/g, '<br>'); });

            const emailEls = document.querySelectorAll('#contactEmailPrimary');
            emailEls.forEach(el => {
                if (c.email) { el.textContent = c.email; el.setAttribute('href', `mailto:${c.email}`); }
            });

            if (c.phone) {
                const waDigits = c.phone.replace(/[^\d]/g, '');
                document.querySelectorAll('#contactPhone').forEach(el => {
                    el.textContent = c.phone;
                    el.setAttribute('href', `https://wa.me/${waDigits}`);
                });
                document.querySelectorAll('#contactWhatsApp').forEach(el => el.setAttribute('href', `https://wa.me/${waDigits}`));
                document.querySelectorAll('#contactCall').forEach(el => el.setAttribute('href', `tel:+${waDigits}`));
                document.querySelectorAll('#contactWhatsAppNumber, #contactCallNumber').forEach(el => { el.textContent = c.phone; });
                document.querySelectorAll('#floatingWhatsApp').forEach(el => {
                    el.setAttribute('href', `https://wa.me/${waDigits}`);
                });
            }

        } catch (e) {
            console.warn("Company profile fetch failed, keeping static defaults:", e);
        }
    }

    async function applySeoDefaults() {
        if (!db) return;
        try {
            const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const snap = await getDoc(doc(db, "config", "seo_settings"));
            if (!snap.exists()) return;
            const s = snap.data();
            if (s.ogImg && !document.querySelector('meta[property="og:image"]')) {
                const tag = document.createElement('meta');
                tag.setAttribute('property', 'og:image');
                tag.setAttribute('content', s.ogImg);
                document.head.appendChild(tag);
            }
        } catch (e) {
            console.warn("SEO defaults fetch failed:", e);
        }
    }

    // ─────────────────────────────────────────────
    // 5b. GOOGLE ANALYTICS / TAG MANAGER
    //    Fixed site-wide IDs plus an optional admin-configured override
    //    (config/system_settings.ga). Both paths are gated on cookie consent
    //    (see initCookieConsent below) — never loaded before the visitor accepts.
    // ─────────────────────────────────────────────
    const GA_MEASUREMENT_ID = 'G-MZE85GGM3K';
    const GTM_CONTAINER_ID = 'GTM-WS9VHVP5';
    let trackingTagsLoaded = false;

    function loadFixedTrackingTags() {
        if (trackingTagsLoaded) return;
        trackingTagsLoaded = true;

        const gtmScript = document.createElement('script');
        gtmScript.textContent = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');`;
        document.head.appendChild(gtmScript);

        const gaLoader = document.createElement('script');
        gaLoader.async = true;
        gaLoader.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
        document.head.appendChild(gaLoader);

        const gaConfig = document.createElement('script');
        gaConfig.textContent = `window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');`;
        document.head.appendChild(gaConfig);
    }

    async function applyGoogleAnalytics() {
        loadFixedTrackingTags();
        if (!db) return;
        try {
            const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const snap = await getDoc(doc(db, "config", "system_settings"));
            if (!snap.exists()) return;
            const gaId = snap.data().ga;
            if (!gaId || gaId === GA_MEASUREMENT_ID) return;

            const s1 = document.createElement('script');
            s1.async = true;
            s1.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
            document.head.appendChild(s1);

            const s2 = document.createElement('script');
            s2.textContent = `window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaId}');`;
            document.head.appendChild(s2);
        } catch (e) {
            console.warn("Google Analytics injection failed:", e);
        }
    }

    // ─────────────────────────────────────────────
    // 5c. SELF-HOSTED PAGEVIEW LOGGING (content/analytics_events)
    //    Powers the admin dashboard's Analytics tab. Fire-and-forget: never
    //    blocks page render, never throws if it fails (e.g. ad blockers).
    // ─────────────────────────────────────────────
    const ANALYTICS_EXCLUDE = [];
    async function logPageview() {
        if (!db) return;
        const currentPage = window.location.pathname.split("/").pop() || "index.html";
        if (ANALYTICS_EXCLUDE.includes(currentPage)) return;
        try {
            const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            await addDoc(collection(db, "analytics_events"), {
                page: currentPage,
                referrer: document.referrer || null,
                lang: localStorage.getItem('zenqor-lang') || 'en',
                timestamp: serverTimestamp()
            });
        } catch (e) {
            console.warn("Pageview logging failed (non-critical):", e);
        }
    }

    // ─────────────────────────────────────────────
    // 5d. COOKIE CONSENT — aligns the existing banner with Google Consent Mode
    //    v2. Analytics remains denied until the visitor explicitly accepts.
    // ─────────────────────────────────────────────
    function initCookieConsent() {
        const banner = document.getElementById('cookie-consent');
        const acceptBtn = document.getElementById('cookie-accept');
        const declineBtn = document.getElementById('cookie-decline');
        if (!banner || !acceptBtn || !declineBtn) return;

        const consentKey = 'zenqor-cookie-consent';
        const consentCopy = {
            en: {
                manage: 'Manage preferences', trigger: 'Cookie settings', title: 'Cookie preferences',
                intro: 'Choose whether Zenqor Technologies may use analytics cookies to understand site traffic.',
                analytics: 'Analytics cookies', analyticsDesc: 'Help us understand aggregate site traffic and improve this website.',
                essential: 'Essential cookies', essentialDesc: 'Always active — required for security and core website functions.',
                save: 'Save choices', accept: 'Accept analytics', reject: 'Reject'
            },
            ms: {
                manage: 'Urus pilihan', trigger: 'Tetapan kuki', title: 'Pilihan kuki',
                intro: 'Pilih sama ada Zenqor Technologies boleh menggunakan kuki analitik untuk memahami trafik laman.',
                analytics: 'Kuki analitik', analyticsDesc: 'Membantu kami memahami trafik laman secara agregat dan menambah baik laman ini.',
                essential: 'Kuki penting', essentialDesc: 'Sentiasa aktif — diperlukan untuk keselamatan dan fungsi utama laman.',
                save: 'Simpan pilihan', accept: 'Terima analitik', reject: 'Tolak'
            }
        };

        const preferencesBtn = document.createElement('button');
        preferencesBtn.type = 'button';
        preferencesBtn.id = 'cookie-preferences';
        preferencesBtn.className = 'cookie-preferences-btn';
        preferencesBtn.setAttribute('data-i18n', 'cookie_manage');
        preferencesBtn.textContent = consentCopy.en.manage;
        declineBtn.before(preferencesBtn);

        document.body.insertAdjacentHTML('beforeend', `
            <button type="button" id="cookie-settings-trigger" class="cookie-settings-trigger" hidden></button>
            <div id="cookie-settings-modal" class="cookie-settings-modal" hidden>
                <div class="cookie-settings-panel" role="dialog" aria-modal="true" aria-labelledby="cookie-settings-title">
                    <div class="cookie-settings-heading">
                        <h2 id="cookie-settings-title"></h2>
                        <button type="button" id="cookie-settings-close" class="cookie-settings-close" aria-label="Close">&times;</button>
                    </div>
                    <p id="cookie-settings-intro"></p>
                    <div class="cookie-setting-row">
                        <div><strong id="cookie-essential-label"></strong><span id="cookie-essential-desc"></span></div>
                        <span class="cookie-always-on">Always on</span>
                    </div>
                    <label class="cookie-setting-row cookie-setting-toggle" for="cookie-analytics-toggle">
                        <div><strong id="cookie-analytics-label"></strong><span id="cookie-analytics-desc"></span></div>
                        <input id="cookie-analytics-toggle" type="checkbox">
                    </label>
                    <div class="cookie-settings-actions">
                        <button type="button" id="cookie-settings-reject" class="btn btn-outline btn-sm"></button>
                        <button type="button" id="cookie-settings-save" class="btn btn-outline btn-sm"></button>
                        <button type="button" id="cookie-settings-accept" class="btn btn-primary btn-sm"></button>
                    </div>
                </div>
            </div>`);

        const modal = document.getElementById('cookie-settings-modal');
        const settingsTrigger = document.getElementById('cookie-settings-trigger');
        const analyticsToggle = document.getElementById('cookie-analytics-toggle');
        const getConsent = () => {
            try { return localStorage.getItem(consentKey); } catch (error) { return null; }
        };
        const updateGoogleConsent = (analyticsGranted) => {
            if (typeof window.gtag !== 'function') return;
            window.gtag('consent', 'update', {
                'ad_storage': 'denied',
                'ad_user_data': 'denied',
                'ad_personalization': 'denied',
                'analytics_storage': analyticsGranted ? 'granted' : 'denied'
            });
        };
        const refreshSettingsCopy = () => {
            const copy = consentCopy[currentLang] || consentCopy.en;
            preferencesBtn.textContent = copy.manage;
            settingsTrigger.textContent = copy.trigger;
            document.getElementById('cookie-settings-title').textContent = copy.title;
            document.getElementById('cookie-settings-intro').textContent = copy.intro;
            document.getElementById('cookie-essential-label').textContent = copy.essential;
            document.getElementById('cookie-essential-desc').textContent = copy.essentialDesc;
            document.getElementById('cookie-analytics-label').textContent = copy.analytics;
            document.getElementById('cookie-analytics-desc').textContent = copy.analyticsDesc;
            document.querySelector('.cookie-always-on').textContent = currentLang === 'ms' ? 'Sentiasa aktif' : 'Always on';
            document.getElementById('cookie-settings-save').textContent = copy.save;
            document.getElementById('cookie-settings-accept').textContent = copy.accept;
            document.getElementById('cookie-settings-reject').textContent = copy.reject;
        };
        const setConsent = (value) => {
            try { localStorage.setItem(consentKey, value); } catch (error) { /* Keep the current-page choice if storage is unavailable. */ }
            const accepted = value === 'accepted';
            updateGoogleConsent(accepted);
            banner.classList.remove('show');
            modal.hidden = true;
            settingsTrigger.hidden = false;
            if (accepted) {
                applyGoogleAnalytics();
                logPageview();
            }
        };
        const openSettings = () => {
            analyticsToggle.checked = getConsent() === 'accepted';
            modal.hidden = false;
            document.getElementById('cookie-settings-close').focus();
        };
        const closeSettings = () => { modal.hidden = true; };

        refreshSettingsCopy();
        document.addEventListener('zenqor:langchange', refreshSettingsCopy);

        const consent = getConsent();
        if (consent === 'accepted') {
            updateGoogleConsent(true);
            settingsTrigger.hidden = false;
            applyGoogleAnalytics();
            logPageview();
        } else if (consent === 'declined') {
            updateGoogleConsent(false);
            settingsTrigger.hidden = false;
        } else {
            requestAnimationFrame(() => banner.classList.add('show'));
        }

        acceptBtn.addEventListener('click', () => setConsent('accepted'));
        declineBtn.addEventListener('click', () => setConsent('declined'));
        preferencesBtn.addEventListener('click', openSettings);
        settingsTrigger.addEventListener('click', openSettings);
        document.getElementById('cookie-settings-close').addEventListener('click', closeSettings);
        document.getElementById('cookie-settings-reject').addEventListener('click', () => setConsent('declined'));
        document.getElementById('cookie-settings-accept').addEventListener('click', () => setConsent('accepted'));
        document.getElementById('cookie-settings-save').addEventListener('click', () => setConsent(analyticsToggle.checked ? 'accepted' : 'declined'));
        modal.addEventListener('click', (event) => { if (event.target === modal) closeSettings(); });
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) closeSettings(); });
    }

    // ─────────────────────────────────────────────
    // 5e. TESTIMONIALS (testimonials collection, admin-managed via Firebase
    //    Console). Section is hidden entirely if none exist yet — never
    //    shows placeholder/fake reviews.
    // ─────────────────────────────────────────────
    async function loadTestimonials() {
        const section = document.getElementById('testimonials-section');
        const grid = document.getElementById('testimonialsGrid');
        if (!section || !grid) return;
        if (!db) { section.style.display = 'none'; return; }
        try {
            const { collection, getDocs, query, orderBy } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");
            const snap = await getDocs(query(collection(db, "testimonials"), orderBy("createdAt", "desc")));
            if (snap.empty) { section.style.display = 'none'; return; }
            grid.innerHTML = "";
            snap.forEach(d => {
                const t = d.data();
                const initials = (t.name || "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
                const rating = Math.min(5, Math.max(1, Number(t.rating) || 5));
                grid.innerHTML += `
                    <article class="testimonial-card card-style reveal active">
                        <div class="stars" aria-label="${rating} out of 5 stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</div>
                        <blockquote>&ldquo;${escapeHtml(t.quote)}&rdquo;</blockquote>
                        <div class="testimonial-author">
                            <div class="testimonial-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
                            <div><strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.company)}</span></div>
                        </div>
                    </article>`;
            });
        } catch (e) {
            console.warn("Testimonials fetch failed:", e);
            section.style.display = 'none';
        }
    }

    await Promise.all([applyContentOverrides(), applyCompanyProfile(), applySeoDefaults(), loadTestimonials()]);
    initCookieConsent();

    try {
        if (!db) throw new Error("Firestore not initialized");
        const { collection, getDocs, doc, getDoc, query, orderBy } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

        const headerConfigSnap = await getDoc(doc(db, "config", "header_settings"));
        let headerConfig = headerConfigSnap.exists() ? headerConfigSnap.data() : {};

        if(headerConfig.logoUrl) document.querySelectorAll('.nav-logo-img, .footer-logo-img').forEach(img => img.src = headerConfig.logoUrl);
        if(headerConfig.headerBackground) {
            const navbar = document.querySelector('.navbar');
            if (navbar) navbar.style.background = headerConfig.headerBackground;
        }

        const navSnap = await getDocs(query(collection(db, "navigation"), orderBy("order", "asc")));
        const navLinksContainer = document.querySelector('.nav-links');

        if(navLinksContainer && !navSnap.empty) {
            let navItems = [];
            navSnap.forEach(d => navItems.push({ id: d.id, ...d.data() }));

            const parents = navItems.filter(i => !i.parentId && i.visible !== false);
            const children = navItems.filter(i => i.parentId && i.visible !== false);

            let htmlBuild = "";
            parents.forEach(p => {
                const myChildren = children.filter(c => c.parentId === p.id);
                if(myChildren.length > 0) {
                    htmlBuild += `
                        <div class="nav-item-dropdown">
                            <button class="dropdown-toggle" data-target="menu-${escapeHtml(p.id)}" aria-expanded="false">
                                <span>${p.icon ? `<i class="${escapeHtml(p.icon)}"></i> ` : ""}${escapeHtml(p.title)}</span> <i class="fas fa-chevron-down" style="font-size: 0.8em; margin-left: 5px;"></i>
                            </button>
                            <div class="dropdown-menu" id="menu-${escapeHtml(p.id)}">
                                ${myChildren.map(c => `<a href="${escapeHtml(c.url)}" target="${escapeHtml(c.target || '_self')}">${c.icon ? `<i class="${escapeHtml(c.icon)}"></i> ` : ""}${escapeHtml(c.title)}</a>`).join('')}
                            </div>
                        </div>`;
                } else {
                    htmlBuild += `<a href="${escapeHtml(p.url)}" target="${escapeHtml(p.target || '_self')}">${p.icon ? `<i class="${escapeHtml(p.icon)}"></i> ` : ""}${escapeHtml(p.title)}</a>`;
                }
            });

            let btnHtml = "";
            if(headerConfig.buttonVisible !== false) {
                btnHtml = `<a href="${escapeHtml(headerConfig.buttonUrl || "https://www.hrct.portal.zenqor.com.my/")}" class="btn btn-primary" style="background-color: ${escapeHtml(headerConfig.buttonColor || 'var(--primary-blue)')}; padding: 8px 20px; border-radius: 6px; text-decoration: none;">${escapeHtml(headerConfig.buttonTitle || "Portal")}</a>`;
            }

            navLinksContainer.innerHTML = htmlBuild + `<div class="nav-actions">
                <button id="lang-toggle" class="lang-btn">EN</button> ${btnHtml}
            </div>`;

        } else if (navLinksContainer && navSnap.empty) {
            navLinksContainer.innerHTML = `
                <a href="index.html" data-i18n="nav_home">Home</a>
                <a href="services.html" data-i18n="nav_services">Services</a>
                <div class="nav-item-dropdown">
                    <button class="dropdown-toggle" data-target="portfolio-menu" aria-expanded="false">
                        <span data-i18n="nav_portfolio">Portfolio</span> <i class="fas fa-chevron-down" style="font-size: 0.8em; margin-left: 5px;"></i>
                    </button>
                    <div class="dropdown-menu" id="portfolio-menu">
                        <a href="licensing_permit.html" data-i18n="nav_port_gaming">Licensing & Permits</a>
                        <a href="portfolio-web.html" data-i18n="nav_port_web">Our Client</a>
                    </div>
                </div>
                <a href="about.html" data-i18n="nav_about">About</a>
                <a href="faq.html" data-i18n="nav_faq">FAQ</a>
                <a href="contact.html" data-i18n="nav_contact">Contact</a>
                <div class="nav-actions">
                    <button id="lang-toggle" class="lang-btn">EN</button>
                    <a href="https://www.hrct.portal.zenqor.com.my/" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" aria-label="Open HRMS/CDTS Portal (opens in a new tab)"><i class="fas fa-arrow-up-right-from-square"></i>Portal</a>
                </div>
            `;
        }

        document.querySelectorAll('.dropdown-toggle').forEach(t => {
            t.addEventListener('click', (e) => {
                e.preventDefault();
                const menu = document.getElementById(t.dataset.target);
                const isExp = t.getAttribute('aria-expanded') === 'true';
                document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.remove('show'));
                document.querySelectorAll('.dropdown-toggle').forEach(btn => btn.setAttribute('aria-expanded', 'false'));
                if (!isExp) { menu.classList.add('show'); t.setAttribute('aria-expanded', 'true'); }
            });
        });

        const toggleBtn = document.getElementById('lang-toggle');
        if(toggleBtn) toggleBtn.addEventListener('click', () => setLanguage(currentLang === 'en' ? 'ms' : 'en'));
        setLanguage(currentLang);

    } catch(e) {
        console.error("CMS Injection Failed:", e);
        setLanguage(currentLang);
    }

    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.querySelector('.nav-links');
    if(mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => navLinks.classList.toggle('active'));
    }

    const scrollToTopBtn = document.getElementById('scrollToTop');
    if(scrollToTopBtn) {
        window.addEventListener('scroll', () => scrollToTopBtn.classList.toggle('show', window.scrollY > 300), { passive: true });
        scrollToTopBtn.addEventListener('click', () => window.scrollTo({top: 0, behavior: 'smooth'}));
    }
})();
