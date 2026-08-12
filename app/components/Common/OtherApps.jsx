import { useTranslation } from "../../locales/translation";
import { useEffect, useRef, useState } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Button,
  Thumbnail,
} from "@shopify/polaris";
import { ChevronLeftIcon, ChevronRightIcon, ExportIcon } from "@shopify/polaris-icons";
import "./OtherApps.css";

const apps = [
  {
    key: "app1",
    icon: "https://cdn.shopify.com/app-store/listing_images/37265693174da884e4e6dc368de9dab7/icon/CP_9pp3CnIkDEAE=.png?height=72&quality=90&width=72",
    url: "https://apps.shopify.com/form-builder-myappgurus",
  },
  {
    key: "app2",
    icon: "https://cdn.shopify.com/app-store/listing_images/df79bafb0a63a5582508b660b89dca1d/icon/CNHJjPmEjf4CEAE=.jpeg?height=72&quality=90&width=72",
    url: "https://apps.shopify.com/wishlist-myappgurus",
  },
  {
    key: "app3",
    icon: "https://cdn.shopify.com/app-store/listing_images/eafd81a81170514e1ea406f20a50bc8a/icon/CMXD5dWfvI4DEAE=.png?height=72&quality=90&width=72",
    url: "https://apps.shopify.com/mag-upsell-crosssell",
  },
  {
    key: "app4",
    icon: "https://cdn.shopify.com/app-store/listing_images/772b08d7aeeedd29dda48e1bbf1918bd/icon/CL2ZuMKHpv4CEAE=.jpeg?height=72&quality=90&width=72",
    url: "https://apps.shopify.com/product-review-myappgurus",
  },
  {
    key: "app5",
    icon: "https://cdn.shopify.com/app-store/listing_images/947d6a4310b97ac2993be68dcede3182/icon/CL20s_-Jtv4CEAE=.jpeg?height=72&quality=90&width=72",
    url: "https://apps.shopify.com/event-management-myappgurus",
  },
];

export default function OtherApps() {
  const t = useTranslation();
  const sliderRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateSliderControls = () => {
    const slider = sliderRef.current;
    if (!slider) return;

    setCanScrollLeft(slider.scrollLeft > 0);
    setCanScrollRight(
      slider.scrollLeft + slider.clientWidth < slider.scrollWidth - 1,
    );
  };

  useEffect(() => {
    updateSliderControls();
    const handleResize = () => updateSliderControls();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const scrollSlider = (direction) => {
    const slider = sliderRef.current;
    if (!slider) return;

    const offset = Math.round(slider.clientWidth * 0.75);
    slider.scrollBy({ left: direction * offset, behavior: "smooth" });
  };

  return (
    <s-section>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {t("otherApps.moreFrom")}
            </Text>

            <Text as="p" tone="subdued">
              {t("otherApps.description")}
            </Text>
          </BlockStack>

          <InlineStack gap="200">
            <Button
              icon={ChevronLeftIcon}
              accessibilityLabel={t("otherApps.slidePrevious")}
              onClick={() => scrollSlider(-1)}
              disabled={!canScrollLeft}
            />
            <Button
              icon={ChevronRightIcon}
              accessibilityLabel={t("otherApps.slideNext")}
              onClick={() => scrollSlider(1)}
              disabled={!canScrollRight}
            />
          </InlineStack>
        </InlineStack>

        <div className="mag-other-app-wrapper">
          <div
            className="mag-other-apps"
            ref={sliderRef}
            onScroll={updateSliderControls}
          >
            {apps.map((app) => (
              <div className="mag-other-app-card" key={app.key}>
                <BlockStack gap="300">
                  <div className="mag-other-app-icon">
                    <Thumbnail
                      source={app.icon}
                      alt={`${t(`otherApps.${app.key}.name`)} icon`}
                      size="large"
                    />
                  </div>

                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">
                      {t(`otherApps.${app.key}.name`)}
                    </Text>

                    <Text as="p" tone="subdued">
                      {t(`otherApps.${app.key}.description`)}
                    </Text>
                  </BlockStack>
                </BlockStack>

                <Button icon={ExportIcon} url={app.url} target="_blank" fullWidth>
                  {t("otherApps.getApp")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </BlockStack>
    </s-section>
  );
}
