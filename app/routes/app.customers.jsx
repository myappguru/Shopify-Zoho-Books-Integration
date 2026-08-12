import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return { shop: session.shop };
};

export default function WelcomePage() {
  return (
    <s-page heading="Welcome">
      <s-section heading="Welcome to MAG : Zoho Book Integration">
        <s-paragraph>
          This app connects your Shopify store with Zoho Books, keeping your
          orders, customers, and invoices in sync automatically.
        </s-paragraph>
        <s-paragraph>
          Use the navigation above to explore the app. Head to the{" "}
          <s-link href="/app">Home</s-link> page to get started.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Getting started">
        <s-unordered-list>
          <s-list-item>Connect your Zoho Books account</s-list-item>
          <s-list-item>Review your sync settings</s-list-item>
          <s-list-item>Check the sync status dashboard</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
