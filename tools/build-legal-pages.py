#!/usr/bin/env python3
"""
Build privacy.html and terms.html from one shared shell.

Why a generator rather than two hand-maintained files: the legal pages carry
the same navbar, skip link, mobile menu, footer and metadata plumbing as every
other route, and the one thing worse than a policy nobody reads is two policies
that disagree with each other because one page was updated and the other was
not. The shell is lifted from an existing page so the pages cannot drift from
the site; only the <section class="policy"> body differs.

Run:  python3 tools/build-legal-pages.py
It rewrites privacy.html and terms.html in place. Re-runnable.

NOTE ON REVEAL CLASSES: the policy text deliberately carries none.
`.reveal` sets `opacity: 0` and is only cleared by script.js, so with
JavaScript unavailable the entire policy is invisible - an unacceptable
failure mode for the one page a visitor may be reading precisely because they
want to know what happens to their data. Legal text renders immediately.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_SHELL = ROOT / "privacy.html"

EFFECTIVE = "16 September 2026"

PRIVACY_TITLE = "Privacy Policy | Herbig Group"
PRIVACY_DESC = (
    "How Herbig Group handles information when you visit this website or send "
    "an inquiry about real estate, land development or a partnership."
)
TERMS_TITLE = "Terms of Use | Herbig Group"
TERMS_DESC = (
    "The permitted use and informational limits of the Herbig Group website, "
    "including project information, inquiries and website content."
)

PRIVACY_BODY = """
          <h2>About this policy</h2>
          <p>This policy explains how information is handled when you visit the Herbig Group website or contact us about real estate, land development or a potential partnership. It covers this website and its inquiry forms. Separate notices or agreements may apply to a later transaction.</p>

          <h2>Information you provide</h2>
          <p>Our contact form collects your name, email address, message and, if you choose to provide it, your organization. Our partnership form collects your organization, email address, the proposed facility purpose and, optionally, a location.</p>
          <p>Each submission carries a reference we generate so that a resent inquiry can be recognised as the same one rather than recorded twice. We also receive information you send by email and in follow-up correspondence.</p>
          <p>Please do not send Social Security numbers, payment information, medical records or confidential transaction documents through these forms.</p>

          <h2>Website and service data</h2>
          <p>Our hosting and delivery providers receive technical information needed to serve the website, such as your IP address, browser information, requested pages or files, request time and referring page when supplied by your browser. They may retain service logs for operation and security.</p>

          <h2>How information is used and handled</h2>
          <p>We use inquiry information to review and respond to your request, discuss a potential project or partnership, and keep a record of the conversation. Technical information supports website delivery, troubleshooting and protection against abuse.</p>
          <p>We do not sell your inquiry information or use it for targeted advertising. Submitting an inquiry does not subscribe you to a mailing list.</p>
          <p>Netlify hosts this website and stores form submissions. A submission first passes through a small program of ours running on Netlify, which checks the fields are complete and within length limits and applies a limit on how many inquiries one network may send in an hour. It briefly keeps the submission reference and a one-way digest of the content, so a resent inquiry can be matched without that record holding your details in readable form. Netlify Forms screens submissions for spam. Form notifications are configured to go to our published email address. Our domain uses Google for email delivery, so notifications and correspondence are handled there as well.</p>
          <p>These providers process information to deliver their services. Information may also need to be disclosed in response to a valid legal requirement or to address fraud, abuse or a security incident.</p>

          <h2>Fonts, animation and browser storage</h2>
          <p>The website loads fonts from Google Fonts and an animation library from jsDelivr. Your browser connects directly to those services and sends technical request information, including your IP address. See <a href="https://policies.google.com/privacy" rel="noopener noreferrer" target="_blank">Google&rsquo;s Privacy Policy</a> and the <a href="https://github.com/jsdelivr/jsdelivr/blob/master/Privacy%20Policy.md" rel="noopener noreferrer" target="_blank">jsDelivr Privacy Policy</a> for how they handle it.</p>
          <p>The site uses session storage to remember whether the introductory animation has played and to restore your position when you return to a page. These settings support navigation and are not used by this site to identify you for advertising.</p>
          <p>This website does not use advertising pixels, analytics tags or cookies for behavioural advertising. It does not track your activity across other websites. Its code does not change behaviour in response to browser Do Not Track signals. Third-party delivery services receive the technical requests described above; their own practices are governed by their notices.</p>

          <h2>Retention and your choices</h2>
          <p>We retain inquiry records as needed to respond, maintain relevant business correspondence and meet applicable legal obligations. Retention may differ between form records, email and service logs.</p>
          <p>You may ask to review, correct or delete information you have provided by emailing <a href="mailto:info@herbiggroup.com">info@herbiggroup.com</a>. We may need to verify that a request relates to your information. Some records may need to be retained for legal obligations or an ongoing matter. Any rights and response requirements under applicable law remain in effect.</p>
          <p>Providing inquiry information is voluntary. If you do not provide a way to reach you, we may be unable to respond. You may email us directly instead of using a form; email still involves processing by email providers.</p>

          <h2>Children and sensitive information</h2>
          <p>This website is intended for business and development inquiries, not for children under 13. If you believe a child has provided personal information, contact us so we can review the matter. The forms are not intended for patient care, housing applications or financial transactions.</p>

          <h2>Changes and contact</h2>
          <p>We will post revisions on this page and update the effective date. If a change requires additional notice or consent under applicable law, that requirement will apply.</p>
          <p>For privacy questions or requests, contact Herbig Group at <a href="mailto:info@herbiggroup.com">info@herbiggroup.com</a>.</p>
"""

TERMS_BODY = """
          <h2>About this website</h2>
          <p>These Terms of Use describe the permitted use and informational limits of the Herbig Group website. The site introduces our real estate and land-development work and provides a way to begin a conversation. It does not establish the terms of a property transaction, construction engagement or partnership.</p>

          <h2>Project information</h2>
          <p>Project descriptions, renderings, drawings and plans are provided for general information. Renderings and concepts illustrate design intent and may not represent completed work or final specifications. Project scope, design, amenities, availability and timing may change as planning, approvals, financing and construction progress.</p>
          <p>References to future development interests do not mean that a project is approved, funded or available for purchase or lease. Confirm current details with us and review the applicable project documents before making a decision.</p>

          <h2>No transaction or investment offer</h2>
          <p>Information on this website is not an offer to sell or lease property, an offer to sell securities, or a solicitation to buy securities. It is not legal, tax, investment, engineering or other professional advice.</p>
          <p>A website inquiry does not reserve property, create a joint venture or agency relationship, or commit either party to a transaction. Any transaction or engagement requires a separate agreement with the appropriate parties. That agreement governs its own subject matter.</p>

          <h2>Inquiries and submissions</h2>
          <p>Please provide accurate contact information and submit only material you are entitled to share. Do not send confidential business plans, privileged information, medical records or financial account details through the inquiry forms. Contact us first to arrange an appropriate method for sensitive material.</p>
          <p>Submitting an inquiry does not, by itself, create a confidentiality agreement. The handling of personal information is described in our <a href="privacy.html">Privacy Policy</a>.</p>

          <h2>Website content and acceptable use</h2>
          <p>The site&rsquo;s text, designs, images, drawings and branding may be protected by intellectual property law and belong to their respective rights holders. You may view the site and share links to it. Other uses require permission from the relevant rights holder unless permitted by law.</p>
          <p>Do not interfere with the website, attempt unauthorized access, submit malicious code or use the forms for spam, impersonation or unlawful activity.</p>

          <h2>Availability and outside services</h2>
          <p>We aim to keep the website useful and accurate, but information may be incomplete or out of date and access may be interrupted. Verify information relevant to a proposed project or transaction directly with us.</p>
          <p>Links to outside websites are provided for reference. Those websites have their own terms and privacy practices. A link does not, by itself, indicate an endorsement.</p>

          <h2>Changes and contact</h2>
          <p>We may update these terms by posting a revised version with a new effective date. Changes to this page do not amend a separate signed agreement. Nothing here limits rights that cannot lawfully be limited.</p>
          <p>For questions about this website or permission to use its content, contact Herbig Group at <a href="mailto:info@herbiggroup.com">info@herbiggroup.com</a>.</p>
"""

SECTION_TEMPLATE = """<section class="policy" data-navbar-theme="dark">
      <div class="policy__inner">
        <span class="accent-bar"></span>
        <p class="policy__eyebrow">Herbig Group</p>
        <h1 class="policy__title">{heading}</h1>
        <p class="policy__updated">Effective {effective}</p>

        <div class="policy__body">{body}        </div>
      </div>
    </section>"""


def split_shell(text):
    """Return (head, tail) around the policy <section>."""
    start = text.index('<section class="policy"')
    end = text.index("</section>", start) + len("</section>")
    return text[:start], text[end:]


def strip_stamped_metadata(head):
    """Remove anything stamp.js owns.

    The shell is lifted from a real page, so it arrives carrying that page's
    canonical and social metadata. Copying those into the other page produced
    a terms.html that declared itself to be the privacy policy - which
    stamp.js would correct on the next build, but which is wrong in the
    repository in the meantime and wrong in any deploy that skips the stamp.
    stamp.js is the single owner of this metadata; the generator must not
    guess at it.
    """
    head = re.sub(r'\s*<link rel="canonical"[^>]*>', "", head)
    head = re.sub(r'\s*<meta property="og:[^"]*"[^>]*>', "", head)
    head = re.sub(r'\s*<meta name="twitter:[^"]*"[^>]*>', "", head)
    return head


def retitle(head, title, description):
    head = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", head, count=1, flags=re.S)
    head = re.sub(
        r'(<meta name="description" content=")(.*?)(">)',
        lambda m: m.group(1) + description + m.group(3),
        head,
        count=1,
        flags=re.S,
    )
    return head


def main():
    shell = SOURCE_SHELL.read_text(encoding="utf-8")
    head, tail = split_shell(shell)

    # The generated pages are static text; script.js and transitions.js still
    # load so the navbar, mobile menu and router behave exactly as elsewhere.
    for filename, title, desc, heading, body in (
        ("privacy.html", PRIVACY_TITLE, PRIVACY_DESC, "Privacy Policy", PRIVACY_BODY),
        ("terms.html", TERMS_TITLE, TERMS_DESC, "Terms of Use", TERMS_BODY),
    ):
        section = SECTION_TEMPLATE.format(heading=heading, effective=EFFECTIVE, body=body)
        page = retitle(strip_stamped_metadata(head), title, desc) + section + tail
        (ROOT / filename).write_text(page, encoding="utf-8")
        print(f"wrote {filename} ({len(page)} bytes)")


if __name__ == "__main__":
    sys.exit(main())
