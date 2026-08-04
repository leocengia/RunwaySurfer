import { beforeEach, describe, expect, it } from 'vitest';
import { extractInternalLinks, extractPageText, hasRenderedContent } from '../lib/extract';

// Scheletro STRUTTURALE (scrubbato) del `[role="main"]` reale di un articolo KB
// Salesforce Aura (fixture Lufthansa, 2026-07-21). Riproduce le 3 colonne:
// header (metadati), colonna 8-of-12 col corpo dentro `c-runway-article-viewer`
// (sezioni `<h2 class="section-title">` annidate in `.article-section`), colonna
// 4-of-12 con Suggested/Trending, e il footer. Contenuti reali/PII redatti;
// tenute solo le frasi-marker che servono agli assert.
const FIXTURE = `
<div role="main" class="body isPageWidthFixed-true">
  <div class="siteforceSldsTwoCol84Layout siteforceContentArea">
    <div class="slds-col--padded comm-content-header comm-layout-column">
      <label class="slds-form-element__label">Preferred Language</label>
      <nav class="forceCommunityBreadcrumbs"><ol><li>
        <a href="/Runway/s/topic/0TO5f000000YTU2GAO/all-brands">All Brands</a>
      </li></ol></nav>
      <header class="forceHighlightsPanel forceCommunityRecordHeadline">
        <div class="slds-text-title">Article Record Type</div><span>Airline Policy</span>
        <div class="slds-text-title">Article Number</div><span>000003395</span>
        <div class="slds-text-title">Publication Status</div><span>Published</span>
      </header>
    </div>
    <div class="slds-grid slds-wrap slds-medium-nowrap">
      <div class="slds-col--padded slds-size--12-of-12 slds-medium-size--8-of-12 comm-layout-column">
        <div data-region-name="content">
          <c-runway-article-viewer>
            <div class="topic-section"><ul>
              <li class="slds-listbox__item"><span title="PLS">PLS</span></li>
              <li class="slds-listbox__item"><span title="Retail">Retail</span></li>
              <li class="slds-listbox__item"><span title="Flight">Flight</span></li>
            </ul></div>
            <div class="article-section"><h2 class="section-title">Details</h2>
              <div class="slds-var-p-around_large"><lightning-formatted-rich-text><span>
                <p>This article includes the following policies for Lufthansa (LH):</p>
                <ul>
                  <li><a href="#ASC">Airline schedule change (ASC) policy</a></li>
                  <li><a href="#NCOR">Name change and name correction policy</a></li>
                </ul>
              </span></lightning-formatted-rich-text></div>
            </div>
            <div class="article-section"><h2 class="section-title">General information</h2>
              <div class="slds-var-p-around_large"><lightning-formatted-rich-text><span>
                <p>Lufthansa Group airlines includes: Austrian Airlines (OS), Brussels Airlines (SN),
                Eurowings (EW), Lufthansa (LH) and SWISS (LX). Tickets are plated on the operating carrier.</p>
              </span></lightning-formatted-rich-text></div>
            </div>
            <div class="article-section"><h2 class="section-title">Name change and name correction</h2>
              <div class="slds-var-p-around_large"><lightning-formatted-rich-text><span>
                <p>The name on a ticket must match the passenger's official document (passport, ID card).
                A name correction of up to two letters is permitted; a full name change to another traveler
                is not allowed and the ticket must be cancelled per the fare rules.</p>
              </span></lightning-formatted-rich-text></div>
            </div>
            <div class="article-section"><h2 class="section-title">Airline tax and refund policies</h2>
              <div class="slds-var-p-around_large"><lightning-formatted-rich-text><span>
                <h3>Requirements for refunds</h3>
                <p>Refunds are not allowed when the schedule change causes a time change of less than two
                hours, or when only the flight number changes. All flights must be cancelled before a refund
                is requested and you must clean up the PNR before submitting any refund.</p>
                <p>For involuntary refunds no fee is charged. Voluntary refunds submitted rather than
                self-serviced via the GDS incur a fee per ticket, collected from the traveler. Fuel
                surcharges (YQ/YR) are non-refundable in North America and are non-refundable if the ticket
                itself is non-refundable. Refer to non-refundable taxes which apply to all airlines and all
                points of sale, and always note the reason for any exemption in the refund application.</p>
                <p>When a round-trip fare is used only one way, the used portion is recalculated to a new
                one-way fare before any refund of the residual amount; if the recalculated value exceeds the
                remaining value, the refund of unused taxes is not permitted. Tell the traveler about any
                applicable refund fee upfront before sending a refund request to the airline back office.</p>
                <p>See also
                <a href="/Runway/s/article/Airline-tax-and-refund-policies-I-Z?language=en_US">Flight | Policies | Tax and refund I-Z</a>.</p>
              </span></lightning-formatted-rich-text></div>
            </div>
            <div class="article-section"><h2 class="section-title">Related Articles</h2>
              <div class="slds-var-p-around_large"><lightning-formatted-rich-text><span>
                <ul><li><a href="/Runway/s/article/Flight-Airline-policies-hub?language=en_US">Flight | Airline policies hub</a></li></ul>
              </span></lightning-formatted-rich-text></div>
            </div>
          </c-runway-article-viewer>
        </div>
      </div>
      <div class="slds-col--padded slds-size--12-of-12 slds-medium-size--4-of-12 comm-layout-column">
        <div data-region-name="sidebar">
          <community_article-similar-articles-list class="comm-related-articles">
            <h2>Suggested Articles</h2>
            <ul>
              <li><a href="/Runway/s/article/WestJet-WS-airline-policies-1694551660238">Flight | Policies | WestJet (WS) Global</a></li>
              <li><a href="/Runway/s/article/American-Airlines-AA-airline-policies-1694551657451">Flight | Policies | American Airlines (AA) Global</a></li>
            </ul>
          </community_article-similar-articles-list>
          <community_article-topic-trending-articles-list>
            <h2>Trending Articles</h2>
            <ul>
              <li><a href="/Runway/s/article/Airline-phone-numbers-for-North-America-and-LATAM-C-D-Global">Flight | Reference | Airline contacts C-D</a></li>
            </ul>
          </community_article-topic-trending-articles-list>
        </div>
      </div>
    </div>
    <div class="slds-col--padded comm-content-footer comm-layout-column">
      <h1>Report a Problem</h1>
      <ul><li>Formatting issues, broken hyperlinks or images? Use the Feedback form to report the problem.</li></ul>
    </div>
  </div>
</div>`;

beforeEach(() => {
  document.body.innerHTML = FIXTURE;
});

describe('estrazione su DOM reale KB (fixture Lufthansa)', () => {
  it('hasRenderedContent è true (il viewer è presente)', () => {
    expect(hasRenderedContent(document)).toBe(true);
  });

  it('il content-root è il corpo articolo: esclude header/metadati, sidebar e footer', () => {
    const text = extractPageText(document, '');
    // corpo vero incluso
    expect(text).toContain('Lufthansa Group airlines includes');
    expect(text).toContain('Refunds are not allowed');
    // chrome/metadati/sidebar/footer ESCLUSI (erano il vero rumore, non i metadati)
    expect(text).not.toContain('Preferred Language');
    expect(text).not.toContain('Article Record Type');
    expect(text).not.toContain('Suggested Articles');
    expect(text).not.toContain('Trending Articles');
    expect(text).not.toContain('Report a Problem');
    // pill dei topic rimosse come rumore
    expect(text).not.toContain('PLS');
  });

  it('E2 per-heading: una query mette a fuoco la sezione giusta (heading annidati)', () => {
    const full = extractPageText(document, '');
    const focused = extractPageText(document, 'refund');
    // la sezione pertinente c'è...
    expect(focused).toContain('Refunds are not allowed');
    // ...e il fuoco RESTRINGE: la sezione "General information" (non pertinente) sparisce
    expect(focused).not.toContain('Lufthansa Group airlines includes');
    expect(focused.length).toBeLessThan(full.length);
  });

  it('la scoperta link usa un root ampio: Suggested/Trending + cross-link del corpo', () => {
    const urls = extractInternalLinks(document).map((l) => l.url);
    expect(urls.some((u) => u.includes('WestJet-WS-airline-policies'))).toBe(true); // Suggested (sidebar)
    expect(urls.some((u) => u.includes('Airline-phone-numbers-for-North-America'))).toBe(true); // Trending
    expect(urls.some((u) => u.includes('Airline-tax-and-refund-policies-I-Z'))).toBe(true); // cross-link corpo
    // i link di tipo topic (breadcrumb) sono scartati da rejectPathIncludes
    expect(urls.some((u) => u.includes('/s/topic/'))).toBe(false);
  });
});
