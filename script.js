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
    const POLICY_CONTENT_KEYS = new Set(['tos_content', 'rp_content', 'dp_content']);

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
            stat_1_value: "SSM Registered", stat_1: "Legally Registered Entity",
            stat_2_value: "Free", stat_2: "Initial Consultation",
            stat_3_value: "Fixed-Fee", stat_3: "Transparent Quotes",
            stat_gov: "Digital Systems", stat_4: "Deployed In-House",

            trust_badge_1: "SSM Registered Entity", trust_badge_2: "Direct Government &amp; Regulatory Liaison", trust_badge_3: "Transparent, Upfront Pricing", trust_badge_4: "Malaysia-Wide Coverage",
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
            about_founded_note: "Founded in 2026, Zenqor Technologies is run by a team bringing 10+ years of combined industry experience.",
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
            faq_8_q: "How do you handle data privacy and PDPA compliance?", faq_8_a: "Client and business data is handled in line with Malaysia's Personal Data Protection Act 2010 and its 2024 amendment. See our <a href=\"data-policy.html\">Data Policy</a> page for full details on how we collect, store, and protect information.",
            faq_9_q: "How do I get started with Zenqor Technologies?", faq_9_a: "Reach out via the <a href=\"contact.html\">Contact</a> page or WhatsApp with a brief description of what you need — company registration, licensing, or a digital system. We'll respond with next steps and, if needed, schedule a consultation.",

            pg_hero_title: "Licensing & <span class='text-primary'>Permit Consulting</span>",
            pg_hero_sub: "Business licences, government permits, and regulatory applications handled on behalf of our clients.",
            pw_hero_title: "Clients We've Worked With", pw_hero_sub: "A showcase of the businesses and organisations Zenqor Technologies has served — company registration, licensing, and digital systems delivered for real clients across Malaysia.",

            tos_content: [
                "<p><strong>Effective date: 16 September 2026</strong></p>",
                "<p>These Legal Notices (\"Terms\") govern your use of this website and the services of Zenqor Technologies (SSM Registration No. 202603157897 (JM1045730-D)). They should be read together with our <a href='data-policy.html'>Data Policy</a> and, for paid engagements, our <a href='return-policy.html'>Return &amp; Refund Policy</a>.</p>",
                "<h2>1. Acceptance of Terms</h2><p>By accessing and using this website or engaging Zenqor Technologies' services, you agree to be bound by these Terms, which are formed and enforceable in accordance with the Contracts Act 1950. Where a separate written service agreement or statement of work is signed for a specific engagement, that document's terms take precedence over these Terms to the extent of any conflict.</p>",
                "<h2>2. Website Content, Copyright &amp; Trademarks</h2><p>Unless otherwise stated, all text, graphics, logos and other material on this website are owned by or licensed to Zenqor Technologies and protected under the Copyright Act 1987. The \"Zenqor\" name and logo are trademarks of Zenqor Technologies; use of the Trade Marks Act 2019 framework does not require registration for copyright to subsist. You may view and print pages for personal, non-commercial reference only; reproduction, redistribution or commercial use without prior written consent is not permitted.</p>",
                "<h2>3. Intellectual Property in Deliverables</h2><p>All systems, deliverables, and materials produced for a client remain the intellectual property of Zenqor Technologies until full payment is received, after which a usage licence (not ownership of the underlying source) is granted to the client, unless the signed service agreement states otherwise.</p>",
                "<h2>4. Consultancy &amp; Licensing Services</h2><p>For business registration, licensing, and government permit application services, Zenqor Technologies acts solely as a professional consultant and facilitator. All decisions to approve, reject, defer, or impose additional conditions on an application rest solely with the relevant Local Authority (PBT), the Companies Commission of Malaysia (SSM), or other competent government agency — Zenqor Technologies does not guarantee approval. Zenqor Technologies is not liable for any rejection, processing delay, or loss arising from inaccurate or incomplete client documents, false information, pre-existing legal or regulatory issues affecting the client's premises, the client's own delay, or a failure to meet applicable technical standards.</p>",
                "<h2>5. Accuracy of Information &amp; Beneficial Ownership</h2><p>Where our services involve company incorporation or company secretarial support, the client is responsible for providing accurate, complete and up-to-date information, including beneficial ownership information required under Section 56 of the Companies Act 2016 and the SSM Practice Directive on beneficial ownership reporting. Zenqor Technologies relies on the information provided by the client and is not liable for penalties, rejections or delays arising from inaccurate, false or outdated information supplied by the client.</p>",
                "<h2>6. Confidentiality &amp; Personal Data</h2><p>Zenqor Technologies keeps all non-public business, technical and financial information shared by a client confidential, and will not disclose it to a third party without prior written consent, except where required by law or reasonably necessary to carry out the engaged services. Personal data is handled in accordance with the Personal Data Protection Act 2010 (Act 709) as further described in our <a href='data-policy.html'>Data Policy</a>.</p>",
                "<h2>7. Website Use &amp; Disclaimer</h2><p>You agree not to misuse this website, including attempting unauthorised access to our systems or interfering with its normal operation. This website and its content are provided on an \"as is\" basis; while we take reasonable care to keep information accurate and current, we do not warrant that the website will be uninterrupted or error-free, and we are not liable for reliance placed on website content in place of a formal written quotation or agreement. Links to third-party websites are provided for convenience and do not constitute endorsement.</p>",
                "<h2>8. Consumer &amp; E-Commerce Disclosures</h2><p>In line with the Consumer Protection (Electronic Trade Transactions) Regulations 2024, our full business name, registration number, address and contact details are displayed on this website (see the footer and our <a href='contact.html'>Contact page</a>), and key policies are available in both Bahasa Malaysia and English via the language toggle.</p>",
                "<h2>9. Dispute Resolution</h2><p>Any dispute, difference in interpretation, or claim arising out of or relating to services provided by Zenqor Technologies will first be addressed through good-faith negotiation for fourteen (14) days after written notice of the dispute.</p>",
                "<h2>10. Governing Law</h2><p>These Terms and any service agreement with Zenqor Technologies are governed by and construed in accordance with the laws of Malaysia, and the parties submit to the exclusive jurisdiction of the courts of Malaysia.</p>"
            ].join(''),
            rp_content: [
                "<p><strong>Effective date: 16 September 2026</strong></p>",
                "<p>This policy applies to the business consulting, digital transformation, digital-system development and digital-skills development services of Zenqor Technologies (SSM Registration No. 202603157897 (JM1045730-D)). It should be read with our <a href='legal.html'>Legal Notices</a> and <a href='data-policy.html'>Data Policy</a>, and with the quotation, proposal, service agreement or statement of work for the relevant engagement. Where those documents set a specific term for that engagement, that specific term applies to the extent permitted by law.</p>",
                "<h2>1. Clear scope, price and timing</h2><p>Before payment is requested, we will provide the agreed scope of service, fees, material third-party charges, payment milestones and estimated delivery or training dates in writing. We do not guarantee a government approval, funding outcome, commercial result or a particular business outcome unless expressly stated in a written agreement signed by Zenqor Technologies.</p>",
                "<h2>2. Cancellation before work starts</h2><p>A client may request cancellation in writing before work begins. If no consultation, discovery, planning, document review, system configuration, training preparation or third-party commitment has started, we will refund the service fee paid, less any non-refundable payment-processing charge that was disclosed before payment.</p>",
                "<h2>3. Cancellation after work starts</h2><p>Once work has begun, a refund is assessed fairly against the value of services already performed, approved expenses and non-refundable third-party commitments. This may include meetings, research, document review, project planning, design or configuration work, development, training preparation, delivered materials and work completed up to the effective cancellation date. Any unused balance that is properly refundable will be returned in accordance with section 7 below.</p>",
                "<h2>4. Rescheduling consultations and training</h2><p>For booked consultations, workshops and digital-skills programmes, please request a reschedule at least three (3) business days before the scheduled start. We will offer one reschedule without an additional service charge where capacity permits. Requests made later may be subject to the reasonable cost of committed trainers, venues, materials or other resources; we will explain those costs before charging them.</p>",
                "<h2>5. Digital deliverables and service remedies</h2><p>Digital deliverables, access credentials, templates, reports and training materials cannot be physically returned once supplied or accessed. If a deliverable materially does not match the agreed written scope, notify us promptly with the relevant details. We will assess the issue and, where appropriate, correct it, re-perform the affected service, provide a reasonable substitute or offer a proportionate refund. This does not affect any remedy required by applicable law.</p>",
                "<h2>6. Government, authority and third-party fees</h2><p>Government, statutory, licensing, inspection, filing, platform, venue, payment-gateway and other third-party fees are separate from Zenqor Technologies' service fee unless our written quotation states otherwise. We will seek approval before incurring a material third-party charge on your behalf. Refunds of fees paid to an authority or third party are determined by that organisation's own rules; where appropriate, we will reasonably assist the client with a refund request but cannot guarantee its outcome.</p>",
                "<h2>7. Refund method and timing</h2><p>Approved refunds are normally returned to the original payment method within fourteen (14) business days after the refund amount is confirmed, subject to the processing time of the bank or payment provider. We may request reasonable information to verify the payment and prevent fraud.</p>",
                "<h2>8. Complaints and escalation</h2><p>Please send a refund or service concern to <a href='mailto:info@zenqor.com.my'>info@zenqor.com.my</a> with your invoice or agreement reference, contact details and a description of the issue. We aim to acknowledge the request within three (3) business days and provide an outcome or next step within fourteen (14) business days. If a matter remains unresolved, eligible consumers may seek information from the <a href='https://ttpm.kpdn.gov.my/'>Tribunal Tuntutan Pengguna Malaysia</a>.</p>",
                "<h2>9. Malaysian consumer and e-commerce protections</h2><p>This policy is intended to support transparent online dealings and is read subject to applicable Malaysian law, including the Consumer Protection Act 1999 and the Consumer Protection (Electronic Trade Transactions) Regulations 2024. Nothing in this policy excludes, restricts or replaces any right or remedy that cannot lawfully be excluded. Official laws, rules and consumer guidance are available from <a href='https://www.kpdn.gov.my/en/public/acts-guidelines-rules'>KPDN</a>.</p>",
                "<h2>10. Updates to this policy</h2><p>We may update this policy to reflect service, operational or legal changes. The version published on this page applies from its effective date. For an existing engagement, the agreed written terms remain applicable unless the parties agree otherwise or the law requires a change.</p>"
            ].join(''),

            dp_content: [
                "<p><strong>Effective date: 16 September 2026</strong></p>",
                "<p>This Data Policy explains how Zenqor Technologies (SSM Registration No. 202603157897 (JM1045730-D)) collects, uses, discloses and protects personal data, in accordance with the Personal Data Protection Act 2010 (Act 709) and the Personal Data Protection (Amendment) Act 2024. It applies to visitors of this website and to clients and prospective clients of our business registration, licensing &amp; permit consulting, and digital systems services.</p>",
                "<h2>1. What Personal Data We Collect</h2><p>Depending on how you interact with us, we may collect: (a) identification details such as name, IC/passport number, and designation; (b) contact details such as email, phone/WhatsApp number, and address; (c) business and company information needed for registration or licensing applications, including company documents, ownership and premises details; (d) communications you send us via the contact form, email or WhatsApp; and (e) limited technical data (such as approximate usage statistics) collected through cookies and analytics, only with your consent.</p>",
                "<h2>2. How We Collect Your Data</h2><p>We collect data directly from you — through the contact form, email, WhatsApp, phone calls, or documents you provide during an engagement — and, with your consent, through analytics cookies while you browse this website (see Section 7).</p>",
                "<h2>3. Why We Collect and Use Your Data (Notice &amp; Choice)</h2><p>We use personal data to: respond to enquiries and provide quotations; prepare, submit and follow up on business registration, licensing and permit applications on your behalf with the relevant authorities; deliver digital systems and consulting services; issue invoices and manage the engagement; and, where you consent, send service-related communications. We do not use your data for purposes unrelated to these without first notifying you or obtaining your consent.</p>",
                "<h2>4. Who We Disclose Your Data To (Disclosure)</h2><p>We do not sell your personal data. We disclose personal data only where necessary: to relevant Malaysian government authorities and regulators (for example SSM, MIDA, MDEC, local authorities (PBT) and other licensing bodies) strictly to process the application or service you have engaged us for; to service providers who process data on our behalf under confidentiality obligations, such as our website/database infrastructure (Google Firebase) and our contact-form processor (FormSubmit); or where required by law or to protect our legal rights.</p>",
                "<h2>5. Cross-Border Data Transfers</h2><p>Some of the service providers above (including Google Firebase) may process or store data on servers located outside Malaysia. Where this occurs, we rely on providers that maintain internationally recognised security and data protection standards, consistent with the cross-border transfer requirements under the PDPA.</p>",
                "<h2>6. Cookies and Analytics</h2><p>This website uses essential cookies required for it to function, and, only with your consent, Google Analytics cookies to understand aggregate site traffic and improve the website. You can accept, reject, or change this choice at any time via Cookie Settings (available in the cookie banner and the site footer). See our cookie banner for details.</p>",
                "<h2>7. How We Protect Your Data (Security)</h2><p>We apply reasonable technical and organisational measures — including access controls, encrypted connections, and restricting access to personal data to personnel who need it to perform their duties — to protect personal data against loss, misuse and unauthorised access, disclosure, alteration or destruction.</p>",
                "<h2>8. How Long We Keep Your Data (Retention)</h2><p>We keep personal data only for as long as necessary to fulfil the purpose it was collected for, to comply with our legal, accounting or regulatory obligations (including statutory record-keeping requirements applicable to company registration and licensing matters), or to resolve disputes, after which it is securely deleted or anonymised.</p>",
                "<h2>9. Keeping Your Data Accurate (Data Integrity)</h2><p>We take reasonable steps to ensure personal data we hold is accurate, complete and not misleading for the purpose it is used. If your details change, please let us know at the contact below so we can update our records.</p>",
                "<h2>10. Your Rights (Access, Correction &amp; Portability)</h2><p>Subject to the PDPA, you have the right to: request access to the personal data we hold about you; request correction of inaccurate or incomplete data; withdraw consent to processing that relies on consent (such as analytics cookies); and request a copy of your data in a commonly used format for transfer, where technically feasible. To exercise any of these rights, contact us using the details in Section 13.</p>",
                "<h2>11. Data Breach Notification</h2><p>If a personal data breach occurs that is likely to result in significant harm to affected individuals, we will notify the Personal Data Protection Commissioner within the timeframe required by law, and notify affected individuals where required, in accordance with the PDPA's data breach notification obligations.</p>",
                "<h2>12. Children's Data</h2><p>Our services are directed at businesses and adults. We do not knowingly collect personal data from children. If you believe a child has provided us with personal data, please contact us so we can remove it.</p>",
                "<h2>13. Data Protection Contact and Complaints</h2><p>For any question, access/correction request, vulnerability report, or data deletion request, please contact us at <a href='mailto:info@zenqor.com.my'>info@zenqor.com.my</a>. If you are not satisfied with our response, you may lodge a complaint with the Personal Data Protection Department of Malaysia (Jabatan Perlindungan Data Peribadi) at <a href='https://www.pdp.gov.my/' target='_blank' rel='noopener noreferrer'>pdp.gov.my</a>.</p>",
                "<h2>14. Updates to This Policy</h2><p>We may update this Data Policy from time to time to reflect changes in our practices or legal requirements. The version published on this page applies from its effective date above.</p>"
            ].join(''),

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
            stat_1_value: "Berdaftar SSM", stat_1: "Entiti Berdaftar Sah",
            stat_2_value: "Percuma", stat_2: "Konsultasi Awal",
            stat_3_value: "Bayaran Tetap", stat_3: "Sebut Harga Telus",
            stat_gov: "Sistem Digital", stat_4: "Dibangunkan Sendiri",

            trust_badge_1: "Entiti Berdaftar SSM", trust_badge_2: "Perhubungan Terus Dengan Kerajaan &amp; Regulator", trust_badge_3: "Harga Telus, Tiada Kos Tersembunyi", trust_badge_4: "Liputan Seluruh Malaysia",
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
            about_founded_note: "Ditubuhkan pada 2026, Zenqor Technologies dikendalikan oleh pasukan yang membawa pengalaman industri gabungan 10+ tahun.",
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
            faq_8_q: "Bagaimana anda menguruskan privasi data dan pematuhan PDPA?", faq_8_a: "Data klien dan perniagaan diuruskan selaras dengan Akta Perlindungan Data Peribadi 2010 Malaysia dan pindaannya pada 2024. Lihat halaman <a href=\"data-policy.html\">Polisi Data</a> kami untuk butiran lengkap tentang cara kami mengumpul, menyimpan, dan melindungi maklumat.",
            faq_9_q: "Bagaimana saya boleh mula bekerjasama dengan Zenqor Technologies?", faq_9_a: "Hubungi kami melalui halaman <a href=\"contact.html\">Hubungi</a> atau WhatsApp dengan penerangan ringkas tentang keperluan anda — pendaftaran syarikat, perlesenan, atau sistem digital. Kami akan membalas dengan langkah seterusnya dan menjadualkan konsultasi jika perlu.",

            pg_hero_title: "Perundingan <span class='text-primary'>Lesen & Permit</span>",
            pg_hero_sub: "Lesen perniagaan, permit kerajaan, dan permohonan regulatori yang diuruskan bagi pihak klien kami.",
            pw_hero_title: "Klien Yang Pernah Kami Bantu", pw_hero_sub: "Pameran perniagaan dan organisasi yang pernah dibantu oleh Zenqor Technologies — pendaftaran syarikat, perlesenan, dan sistem digital yang dihasilkan untuk klien sebenar di seluruh Malaysia.",

            tos_content: [
                "<p><strong>Tarikh kuat kuasa: 16 September 2026</strong></p>",
                "<p>Notis Undang-Undang ini (\"Terma\") mentadbir penggunaan laman web ini dan perkhidmatan Zenqor Technologies (No. Pendaftaran SSM 202603157897 (JM1045730-D)). Ia perlu dibaca bersama <a href='data-policy.html'>Polisi Data</a> kami dan, bagi penglibatan berbayar, <a href='return-policy.html'>Polisi Pemulangan &amp; Bayaran Balik</a> kami.</p>",
                "<h2>1. Penerimaan Terma</h2><p>Dengan mengakses dan menggunakan laman web ini atau melibatkan perkhidmatan Zenqor Technologies, anda bersetuju untuk terikat dengan Terma ini, yang dibentuk dan boleh dikuatkuasakan selaras dengan Akta Kontrak 1950. Jika perjanjian perkhidmatan bertulis berasingan atau skop kerja ditandatangani bagi penglibatan tertentu, terma dokumen tersebut diutamakan berbanding Terma ini setakat mana-mana percanggahan.</p>",
                "<h2>2. Kandungan Laman Web, Hak Cipta &amp; Cap Dagangan</h2><p>Melainkan dinyatakan sebaliknya, semua teks, grafik, logo dan bahan lain pada laman web ini dimiliki oleh atau dilesenkan kepada Zenqor Technologies dan dilindungi di bawah Akta Hak Cipta 1987. Nama dan logo \"Zenqor\" adalah cap dagangan Zenqor Technologies di bawah rangka kerja Akta Cap Dagangan 2019; pendaftaran tidak diperlukan untuk hak cipta wujud. Anda boleh melihat dan mencetak halaman untuk rujukan peribadi bukan komersial sahaja; pengeluaran semula, pengedaran semula atau penggunaan komersial tanpa persetujuan bertulis terlebih dahulu tidak dibenarkan.</p>",
                "<h2>3. Hak Harta Intelek Dalam Hasil Kerja</h2><p>Semua sistem, hasil kerja, dan bahan yang dihasilkan untuk klien kekal sebagai hak harta intelek Zenqor Technologies sehingga bayaran penuh diterima, selepas itu lesen penggunaan (bukan pemilikan kod sumber) diberikan kepada pelanggan, melainkan perjanjian perkhidmatan yang ditandatangani menyatakan sebaliknya.</p>",
                "<h2>4. Perkhidmatan Perundingan &amp; Perlesenan</h2><p>Bagi perkhidmatan pendaftaran perniagaan, perlesenan, dan permohonan permit kerajaan, Zenqor Technologies bertindak semata-mata sebagai perunding profesional dan fasilitator. Semua keputusan untuk meluluskan, menolak, menangguhkan atau mengenakan syarat tambahan terhadap sesuatu permohonan terletak sepenuhnya pada Pihak Berkuasa Tempatan (PBT), Suruhanjaya Syarikat Malaysia (SSM), atau agensi kerajaan berwajib yang lain — Zenqor Technologies tidak menjamin kelulusan. Zenqor Technologies tidak bertanggungjawab terhadap sebarang penolakan, kelewatan pemprosesan atau kerugian yang berpunca daripada dokumen pelanggan yang tidak tepat atau tidak lengkap, maklumat palsu, isu undang-undang atau kawal selia sedia ada yang menjejaskan premis pelanggan, kelewatan oleh pelanggan sendiri, atau kegagalan memenuhi piawaian teknikal yang berkenaan.</p>",
                "<h2>5. Ketepatan Maklumat &amp; Pemilik Benefisial</h2><p>Bagi perkhidmatan yang melibatkan penubuhan syarikat atau sokongan setiausaha syarikat, klien bertanggungjawab menyediakan maklumat yang tepat, lengkap dan terkini, termasuk maklumat pemilik benefisial yang diwajibkan di bawah Seksyen 56 Akta Syarikat 2016 dan Panduan Amalan SSM mengenai pelaporan pemilik benefisial. Zenqor Technologies bergantung kepada maklumat yang diberikan oleh klien dan tidak bertanggungjawab terhadap penalti, penolakan atau kelewatan yang berpunca daripada maklumat yang tidak tepat, palsu atau lapuk yang dibekalkan oleh klien.</p>",
                "<h2>6. Kerahsiaan &amp; Data Peribadi</h2><p>Zenqor Technologies merahsiakan semua maklumat perniagaan, teknikal dan kewangan bukan awam yang dikongsi oleh pelanggan, dan tidak akan mendedahkannya kepada pihak ketiga tanpa persetujuan bertulis terlebih dahulu, kecuali jika diwajibkan oleh undang-undang atau semunasabahnya diperlukan untuk melaksanakan perkhidmatan yang dilibatkan. Data peribadi dikendalikan selaras dengan Akta Perlindungan Data Peribadi 2010 (Akta 709) sepertimana diterangkan lanjut dalam <a href='data-policy.html'>Polisi Data</a> kami.</p>",
                "<h2>7. Penggunaan Laman Web &amp; Penafian</h2><p>Anda bersetuju untuk tidak menyalahgunakan laman web ini, termasuk cubaan akses tanpa kebenaran kepada sistem kami atau mengganggu operasi normalnya. Laman web ini dan kandungannya disediakan atas dasar \"seadanya\"; walaupun kami mengambil langkah munasabah untuk memastikan maklumat tepat dan terkini, kami tidak menjamin laman web ini bebas gangguan atau bebas ralat, dan kami tidak bertanggungjawab atas pergantungan kepada kandungan laman web sebagai ganti sebut harga atau perjanjian bertulis rasmi. Pautan ke laman web pihak ketiga disediakan untuk kemudahan dan tidak membawa maksud pengesahan.</p>",
                "<h2>8. Pendedahan Pengguna &amp; E-Dagang</h2><p>Selaras dengan Peraturan-Peraturan Perlindungan Pengguna (Transaksi Perdagangan Elektronik) 2024, nama perniagaan penuh, nombor pendaftaran, alamat dan butiran hubungan kami dipaparkan pada laman web ini (lihat footer dan <a href='contact.html'>halaman Hubungi</a> kami), dan polisi utama tersedia dalam Bahasa Malaysia dan Bahasa Inggeris melalui suis bahasa.</p>",
                "<h2>9. Penyelesaian Pertikaian</h2><p>Sebarang pertikaian, perbezaan tafsiran atau tuntutan yang timbul daripada atau berkaitan dengan perkhidmatan yang disediakan oleh Zenqor Technologies akan diselesaikan terlebih dahulu melalui rundingan dengan niat baik selama empat belas (14) hari selepas notis bertulis mengenai pertikaian diberikan.</p>",
                "<h2>10. Undang-Undang yang Mengawal</h2><p>Terma ini dan mana-mana perjanjian perkhidmatan dengan Zenqor Technologies ditadbir dan ditafsirkan mengikut undang-undang Malaysia, dan pihak-pihak bersetuju untuk tertakluk sepenuhnya pada bidang kuasa mahkamah Malaysia.</p>"
            ].join(''),
            rp_content: [
                "<p><strong>Tarikh kuat kuasa: 16 September 2026</strong></p>",
                "<p>Polisi ini terpakai kepada perkhidmatan perundingan perniagaan, transformasi digital, pembangunan sistem digital dan pembangunan kemahiran digital oleh Zenqor Technologies (No. Pendaftaran SSM 202603157897 (JM1045730-D)). Polisi ini perlu dibaca bersama <a href='legal.html'>Notis Undang-Undang</a> dan <a href='data-policy.html'>Polisi Data</a> kami, serta sebut harga, cadangan, perjanjian perkhidmatan atau skop kerja bagi penglibatan berkenaan. Jika dokumen tersebut menetapkan terma khusus, terma khusus itu terpakai setakat yang dibenarkan oleh undang-undang.</p>",
                "<h2>1. Skop, harga dan tempoh yang jelas</h2><p>Sebelum bayaran diminta, kami akan memberikan skop perkhidmatan yang dipersetujui, yuran, caj pihak ketiga yang material, peringkat bayaran dan anggaran tarikh penyerahan atau latihan secara bertulis. Kami tidak menjamin kelulusan kerajaan, hasil pembiayaan, hasil komersial atau hasil perniagaan tertentu kecuali dinyatakan dengan jelas dalam perjanjian bertulis yang ditandatangani oleh Zenqor Technologies.</p>",
                "<h2>2. Pembatalan sebelum kerja bermula</h2><p>Klien boleh meminta pembatalan secara bertulis sebelum kerja dimulakan. Jika tiada konsultasi, penemuan, perancangan, semakan dokumen, konfigurasi sistem, penyediaan latihan atau komitmen pihak ketiga telah dimulakan, kami akan memulangkan yuran perkhidmatan yang dibayar selepas menolak caj pemprosesan bayaran yang tidak boleh dikembalikan dan telah dimaklumkan sebelum bayaran dibuat.</p>",
                "<h2>3. Pembatalan selepas kerja bermula</h2><p>Selepas kerja bermula, bayaran balik akan dinilai secara adil berdasarkan nilai perkhidmatan yang telah dilaksanakan, perbelanjaan yang diluluskan dan komitmen pihak ketiga yang tidak boleh dikembalikan. Ini boleh merangkumi mesyuarat, penyelidikan, semakan dokumen, perancangan projek, kerja reka bentuk atau konfigurasi, pembangunan, penyediaan latihan, bahan yang diserahkan dan kerja yang disiapkan sehingga tarikh pembatalan berkuat kuasa. Baki yang tidak digunakan dan layak dibayar balik akan dipulangkan menurut seksyen 7 di bawah.</p>",
                "<h2>4. Penjadualan semula konsultasi dan latihan</h2><p>Bagi konsultasi, bengkel dan program pembangunan kemahiran digital yang telah ditempah, sila mohon penjadualan semula sekurang-kurangnya tiga (3) hari perniagaan sebelum waktu mula. Kami akan menawarkan satu penjadualan semula tanpa caj perkhidmatan tambahan jika kapasiti membenarkan. Permintaan lewat mungkin tertakluk kepada kos munasabah bagi jurulatih, tempat, bahan atau sumber lain yang telah ditempah; kami akan menerangkan kos tersebut sebelum mengenakannya.</p>",
                "<h2>5. Hasil kerja digital dan remedi perkhidmatan</h2><p>Hasil kerja digital, kelayakan akses, templat, laporan dan bahan latihan tidak boleh dipulangkan secara fizikal selepas dibekalkan atau diakses. Jika hasil kerja secara material tidak menepati skop bertulis yang dipersetujui, maklumkan kepada kami segera dengan butiran yang berkaitan. Kami akan menilai isu tersebut dan, jika sesuai, membetulkannya, melaksanakan semula perkhidmatan terjejas, menyediakan pengganti yang munasabah atau menawarkan bayaran balik berkadar. Ini tidak menjejaskan mana-mana remedi yang diwajibkan oleh undang-undang terpakai.</p>",
                "<h2>6. Yuran kerajaan, pihak berkuasa dan pihak ketiga</h2><p>Yuran kerajaan, statutori, pelesenan, pemeriksaan, pemfailan, platform, tempat, gerbang bayaran dan yuran pihak ketiga lain adalah berasingan daripada yuran perkhidmatan Zenqor Technologies melainkan sebut harga bertulis kami menyatakan sebaliknya. Kami akan mendapatkan kelulusan sebelum menanggung caj pihak ketiga yang material bagi pihak klien. Bayaran balik bagi yuran yang dibayar kepada pihak berkuasa atau pihak ketiga ditentukan oleh peraturan organisasi tersebut; jika sesuai, kami akan membantu klien secara munasabah untuk membuat permohonan bayaran balik tetapi tidak boleh menjamin hasilnya.</p>",
                "<h2>7. Kaedah dan tempoh bayaran balik</h2><p>Bayaran balik yang diluluskan lazimnya dipulangkan kepada kaedah bayaran asal dalam tempoh empat belas (14) hari perniagaan selepas jumlah bayaran balik disahkan, tertakluk kepada tempoh pemprosesan bank atau penyedia bayaran. Kami boleh meminta maklumat munasabah untuk mengesahkan bayaran dan mencegah penipuan.</p>",
                "<h2>8. Aduan dan eskalasi</h2><p>Sila hantar pertanyaan bayaran balik atau kebimbangan perkhidmatan kepada <a href='mailto:info@zenqor.com.my'>info@zenqor.com.my</a> bersama rujukan invois atau perjanjian, butiran hubungan dan penerangan isu. Kami berhasrat mengakui penerimaan permintaan dalam tiga (3) hari perniagaan dan memberikan keputusan atau langkah seterusnya dalam empat belas (14) hari perniagaan. Jika isu masih tidak selesai, pengguna yang layak boleh mendapatkan maklumat daripada <a href='https://ttpm.kpdn.gov.my/'>Tribunal Tuntutan Pengguna Malaysia</a>.</p>",
                "<h2>9. Perlindungan pengguna dan e-dagang Malaysia</h2><p>Polisi ini bertujuan menyokong urus niaga dalam talian yang telus dan dibaca tertakluk kepada undang-undang Malaysia yang terpakai, termasuk Akta Perlindungan Pengguna 1999 dan Peraturan-Peraturan Perlindungan Pengguna (Transaksi Perdagangan Elektronik) 2024. Tiada apa-apa dalam polisi ini mengecualikan, mengehadkan atau menggantikan hak atau remedi yang tidak boleh diketepikan di sisi undang-undang. Undang-undang, peraturan dan panduan pengguna rasmi boleh dirujuk melalui <a href='https://www.kpdn.gov.my/en/public/acts-guidelines-rules'>KPDN</a>.</p>",
                "<h2>10. Kemaskini polisi</h2><p>Kami boleh mengemas kini polisi ini untuk mencerminkan perubahan perkhidmatan, operasi atau undang-undang. Versi yang diterbitkan pada halaman ini terpakai mulai tarikh kuat kuasanya. Bagi penglibatan sedia ada, terma bertulis yang dipersetujui kekal terpakai melainkan dipersetujui sebaliknya oleh pihak-pihak atau perubahan diwajibkan oleh undang-undang.</p>"
            ].join(''),

            dp_content: [
                "<p><strong>Tarikh kuat kuasa: 16 September 2026</strong></p>",
                "<p>Polisi Data ini menerangkan bagaimana Zenqor Technologies (No. Pendaftaran SSM 202603157897 (JM1045730-D)) mengumpul, menggunakan, mendedahkan dan melindungi data peribadi, selaras dengan Akta Perlindungan Data Peribadi 2010 (Akta 709) dan Akta Perlindungan Data Peribadi (Pindaan) 2024. Polisi ini terpakai kepada pelawat laman web ini serta klien dan bakal klien bagi perkhidmatan pendaftaran perniagaan, perundingan lesen &amp; permit, dan sistem digital kami.</p>",
                "<h2>1. Data Peribadi Yang Kami Kumpul</h2><p>Bergantung kepada cara anda berinteraksi dengan kami, kami mungkin mengumpul: (a) butiran pengenalan seperti nama, nombor IC/pasport, dan jawatan; (b) butiran hubungan seperti e-mel, nombor telefon/WhatsApp, dan alamat; (c) maklumat perniagaan dan syarikat yang diperlukan untuk pendaftaran atau permohonan lesen, termasuk dokumen syarikat, butiran pemilikan dan premis; (d) komunikasi yang anda hantar melalui borang hubungi, e-mel atau WhatsApp; dan (e) data teknikal terhad (seperti statistik penggunaan anggaran) yang dikumpul melalui kuki dan analitik, hanya dengan kebenaran anda.</p>",
                "<h2>2. Bagaimana Kami Mengumpul Data Anda</h2><p>Kami mengumpul data terus daripada anda — melalui borang hubungi, e-mel, WhatsApp, panggilan telefon, atau dokumen yang anda berikan semasa penglibatan perkhidmatan — dan, dengan kebenaran anda, melalui kuki analitik semasa anda melayari laman web ini (lihat Seksyen 7).</p>",
                "<h2>3. Mengapa Kami Mengumpul dan Menggunakan Data Anda (Notis &amp; Pilihan)</h2><p>Kami menggunakan data peribadi untuk: membalas pertanyaan dan menyediakan sebut harga; menyediakan, menghantar dan menyusuli permohonan pendaftaran perniagaan, lesen dan permit bagi pihak anda kepada pihak berkuasa berkaitan; menyampaikan perkhidmatan sistem digital dan perundingan; mengeluarkan invois dan menguruskan penglibatan; dan, dengan kebenaran anda, menghantar komunikasi berkaitan perkhidmatan. Kami tidak menggunakan data anda untuk tujuan yang tidak berkaitan dengan perkara di atas tanpa memaklumkan atau mendapatkan kebenaran anda terlebih dahulu.</p>",
                "<h2>4. Kepada Siapa Kami Mendedahkan Data Anda (Pendedahan)</h2><p>Kami tidak menjual data peribadi anda. Kami mendedahkan data peribadi hanya apabila perlu: kepada pihak berkuasa dan agensi kerajaan Malaysia yang berkaitan (contohnya SSM, MIDA, MDEC, Pihak Berkuasa Tempatan (PBT) dan badan pelesenan lain) semata-mata untuk memproses permohonan atau perkhidmatan yang anda libatkan kami untuknya; kepada penyedia perkhidmatan yang memproses data bagi pihak kami di bawah kewajipan kerahsiaan, seperti infrastruktur laman web/pangkalan data kami (Google Firebase) dan pemproses borang hubungi kami (FormSubmit); atau apabila diwajibkan oleh undang-undang atau untuk melindungi hak undang-undang kami.</p>",
                "<h2>5. Pemindahan Data Merentas Sempadan</h2><p>Sebahagian penyedia perkhidmatan di atas (termasuk Google Firebase) mungkin memproses atau menyimpan data pada pelayan yang terletak di luar Malaysia. Apabila ini berlaku, kami bergantung kepada penyedia yang mengekalkan piawaian keselamatan dan perlindungan data yang diiktiraf secara antarabangsa, selaras dengan keperluan pemindahan merentas sempadan di bawah PDPA.</p>",
                "<h2>6. Kuki dan Analitik</h2><p>Laman web ini menggunakan kuki penting yang diperlukan untuk ia berfungsi, dan, hanya dengan kebenaran anda, kuki Google Analytics untuk memahami trafik laman secara agregat dan menambah baik laman web. Anda boleh menerima, menolak, atau menukar pilihan ini pada bila-bila masa melalui Tetapan Kuki (tersedia pada notis kuki dan footer laman). Rujuk notis kuki kami untuk maklumat lanjut.</p>",
                "<h2>7. Bagaimana Kami Melindungi Data Anda (Keselamatan)</h2><p>Kami melaksanakan langkah teknikal dan organisasi yang munasabah — termasuk kawalan akses, sambungan disulitkan, dan menghadkan akses kepada data peribadi kepada kakitangan yang memerlukannya untuk menjalankan tugas — bagi melindungi data peribadi daripada kehilangan, penyalahgunaan dan akses, pendedahan, pengubahan atau pemusnahan tanpa kebenaran.</p>",
                "<h2>8. Berapa Lama Kami Menyimpan Data Anda (Penyimpanan)</h2><p>Kami menyimpan data peribadi hanya selama yang diperlukan untuk memenuhi tujuan ia dikumpul, mematuhi kewajipan undang-undang, perakaunan atau regulatori kami (termasuk keperluan penyimpanan rekod berkanun yang terpakai bagi hal pendaftaran syarikat dan perlesenan), atau menyelesaikan pertikaian, selepas itu ia dipadam atau dinamakan secara selamat.</p>",
                "<h2>9. Memastikan Data Anda Tepat (Integriti Data)</h2><p>Kami mengambil langkah munasabah untuk memastikan data peribadi yang kami simpan adalah tepat, lengkap dan tidak mengelirukan bagi tujuan ia digunakan. Jika butiran anda berubah, sila maklumkan kami di hubungan di bawah supaya kami dapat mengemas kini rekod kami.</p>",
                "<h2>10. Hak Anda (Akses, Pembetulan &amp; Kemudahalihan)</h2><p>Tertakluk kepada PDPA, anda berhak untuk: memohon akses kepada data peribadi yang kami simpan tentang anda; memohon pembetulan data yang tidak tepat atau tidak lengkap; menarik balik kebenaran bagi pemprosesan yang bergantung kepada kebenaran (seperti kuki analitik); dan memohon salinan data anda dalam format yang lazim digunakan untuk pemindahan, jika secara teknikal boleh dilaksanakan. Untuk menggunakan mana-mana hak ini, hubungi kami menggunakan butiran di Seksyen 13.</p>",
                "<h2>11. Notis Pelanggaran Data</h2><p>Jika berlaku pelanggaran data peribadi yang berkemungkinan mengakibatkan kemudaratan ketara kepada individu terjejas, kami akan memaklumkan Pesuruhjaya Perlindungan Data Peribadi dalam tempoh masa yang diwajibkan oleh undang-undang, dan memaklumkan individu terjejas jika diperlukan, selaras dengan kewajipan notis pelanggaran data di bawah PDPA.</p>",
                "<h2>12. Data Kanak-Kanak</h2><p>Perkhidmatan kami ditujukan kepada perniagaan dan orang dewasa. Kami tidak mengumpul data peribadi daripada kanak-kanak secara sengaja. Jika anda percaya seorang kanak-kanak telah memberikan data peribadi kepada kami, sila hubungi kami supaya ia dapat dibuang.</p>",
                "<h2>13. Hubungan Perlindungan Data dan Aduan</h2><p>Untuk sebarang pertanyaan, permohonan akses/pembetulan, laporan kelemahan sistem, atau permintaan pemadaman data, sila hubungi kami di <a href='mailto:info@zenqor.com.my'>info@zenqor.com.my</a>. Jika anda tidak berpuas hati dengan respons kami, anda boleh membuat aduan kepada Jabatan Perlindungan Data Peribadi Malaysia di <a href='https://www.pdp.gov.my/' target='_blank' rel='noopener noreferrer'>pdp.gov.my</a>.</p>",
                "<h2>14. Kemaskini Polisi Ini</h2><p>Kami boleh mengemas kini Polisi Data ini dari semasa ke semasa untuk mencerminkan perubahan amalan atau keperluan undang-undang kami. Versi yang diterbitkan pada halaman ini terpakai mulai tarikh kuat kuasa di atas.</p>"
            ].join(''),

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
    //    Google Analytics is installed statically in every page head so Google
    //    can verify it. Only the GTM container is loaded after consent.
    // ─────────────────────────────────────────────
    const GTM_CONTAINER_ID = 'GTM-WS9VHVP5';
    let trackingTagsLoaded = false;

    function loadFixedTrackingTags() {
        if (trackingTagsLoaded) return;
        trackingTagsLoaded = true;

        // The homepage already has the same GTM snippet in its static markup.
        // Do not add a second container when consent is granted.
        if (document.querySelector(`script[src*="gtm.js?id=${GTM_CONTAINER_ID}"]`)) return;

        const gtmScript = document.createElement('script');
        gtmScript.textContent = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');`;
        document.head.appendChild(gtmScript);
    }

    async function applyGoogleAnalytics() {
        loadFixedTrackingTags();
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
                btnHtml = `<a href="${escapeHtml(headerConfig.buttonUrl || "https://www.hrconnect.zenqor.com.my/")}" class="btn btn-primary" style="background-color: ${escapeHtml(headerConfig.buttonColor || 'var(--primary-blue)')}; padding: 8px 20px; border-radius: 6px; text-decoration: none;">${escapeHtml(headerConfig.buttonTitle || "Portal")}</a>`;
            }

            navLinksContainer.innerHTML = htmlBuild + `<div class="nav-actions">
                <button id="lang-toggle" class="lang-btn">EN</button> ${btnHtml}
            </div>`;

        } else if (navLinksContainer && navSnap.empty) {
            navLinksContainer.innerHTML = `
                <a href="index.html" data-i18n="nav_home">Home</a>
                <a href="services.html" data-i18n="nav_services">Services</a>
                <a href="licensing_permit.html" data-i18n="nav_port_gaming">Licensing & Permits</a>
                <a href="about.html" data-i18n="nav_about">About</a>
                <a href="faq.html" data-i18n="nav_faq">FAQ</a>
                <a href="contact.html" data-i18n="nav_contact">Contact</a>
                <div class="nav-actions">
                    <button id="lang-toggle" class="lang-btn">EN</button>
                    <a href="https://www.hrconnect.zenqor.com.my/" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" aria-label="Open HRMS/CDTS Portal (opens in a new tab)"><i class="fas fa-arrow-up-right-from-square"></i>Portal</a>
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
