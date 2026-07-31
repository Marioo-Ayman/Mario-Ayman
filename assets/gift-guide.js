// @ts-nocheck
/**
 * gift-guide.js
 * ---------------------------------------------------------------------------
 * Vanilla JS (no jQuery) powering the Gift Guide Banner + Grid sections.
 *
 * Responsibilities:
 *  1. Animate the "SHOP NOW" / "CHOOSE GIFT" buttons and the mobile menu
 *     toggle in the Banner section.
 *  2. Open a single shared quick-view modal from any grid tile, dynamically
 *     rendering that product's name, price, description and variant
 *     controls from the JSON data island rendered next to each tile.
 *  3. Add the selected variant to the cart via the Ajax Cart API.
 *  4. Business rule: if the variant being added combines the "Black" and
 *     "Medium" option values (in any option position), also add the
 *     merchant-configured bundle product (e.g. "Soft Winter Jacket") to
 *     the cart in the same request.
 *
 * The script is idempotent/guarded so it is safe to include on both the
 * Banner and the Grid section without initializing twice.
 * ---------------------------------------------------------------------------
 */
(function () {
  "use strict";

  // Guard against double-initialisation if both sections load this file.
  if (window.__giftGuideInitialised) return;
  window.__giftGuideInitialised = true;

  /* ---------------------------------------------------------------------
   * 1. Banner: mobile menu toggle
   * ------------------------------------------------------------------- */
  function initMobileMenu() {
    var toggles = document.querySelectorAll(".gift-banner__menu-toggle");

    toggles.forEach(function (toggle) {
      var targetId = toggle.getAttribute("aria-controls");
      var target = targetId && document.getElementById(targetId);
      if (!target) return;

      toggle.addEventListener("click", function () {
        var isOpen = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!isOpen));
        target.hidden = isOpen;
        toggle.classList.toggle("is-active", !isOpen);
      });
    });
  }

  /* ---------------------------------------------------------------------
   * 2. Quick-view modal
   * ------------------------------------------------------------------- */
  var modal = null;
  var modalRefs = {};
  var currentProduct = null; // parsed JSON for the product currently open
  var selectedOptions = []; // e.g. ["Blue", "M"] indexed by option position
  var lastFocusedTrigger = null;

  function cacheModalRefs() {
    modal = document.getElementById("GiftGuideModal");
    if (!modal) return false;

    modalRefs = {
      dialog: modal.querySelector(".gift-modal__dialog"),
      image: modal.querySelector(".gift-modal__image"),
      title: modal.querySelector(".gift-modal__title"),
      price: modal.querySelector(".gift-modal__price"),
      description: modal.querySelector(".gift-modal__description"),
      options: modal.querySelector(".gift-modal__options"),
      addToCart: modal.querySelector(".gift-modal__add-to-cart"),
      message: modal.querySelector(".gift-modal__message"),
    };
    return true;
  }

  function getProductJSON(blockId) {
    var node = document.querySelector(
      '[data-gift-guide-product="' + blockId + '"]',
    );
    if (!node) return null;
    try {
      return JSON.parse(node.textContent);
    } catch (err) {
      console.error(
        "Gift Guide: could not parse product JSON for block",
        blockId,
        err,
      );
      return null;
    }
  }

  // Find the variant whose option1/2/3 match the currently selected options.
  function findMatchingVariant() {
    if (!currentProduct) return null;
    return (
      currentProduct.variants.find(function (variant) {
        var variantOptions = [
          variant.option1,
          variant.option2,
          variant.option3,
        ];
        return currentProduct.options.every(function (option) {
          var pos = option.position - 1;
          // If this option only has one/no value recorded, treat as a match.
          if (selectedOptions[pos] == null) return true;
          return variantOptions[pos] === selectedOptions[pos];
        });
      }) || null
    );
  }

  function renderOptionControls() {
    modalRefs.options.innerHTML = "";

    currentProduct.options.forEach(function (option) {
      var pos = option.position - 1;
      var group = document.createElement("div");
      group.className = "gift-modal__option-group";

      var label = document.createElement("p");
      label.className = "gift-modal__option-label";
      label.textContent = option.name;
      group.appendChild(label);

      var isSizeLike = /size/i.test(option.name);

      if (isSizeLike) {
        // Render as a <select> to match "Choose your size" in the design.
        var select = document.createElement("select");
        select.className = "gift-modal__select";
        select.setAttribute("data-option-position", String(pos));

        var placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Choose your size";
        placeholder.disabled = true;
        placeholder.selected = !selectedOptions[pos];
        select.appendChild(placeholder);

        option.values.forEach(function (value) {
          var opt = document.createElement("option");
          opt.value = value;
          opt.textContent = value;
          opt.selected = selectedOptions[pos] === value;
          select.appendChild(opt);
        });

        select.addEventListener("change", function () {
          selectedOptions[pos] = select.value;
          onOptionsChanged();
        });

        var wrap = document.createElement("div");
        wrap.className = "gift-modal__select-wrap";
        wrap.appendChild(select);
        group.appendChild(wrap);
      } else {
        // Render as a segmented button group (e.g. Color: Blue / Black).
        var buttonRow = document.createElement("div");
        buttonRow.className = "gift-modal__button-row";

        option.values.forEach(function (value) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "gift-modal__option-button";
          btn.textContent = value;
          btn.setAttribute("data-option-position", String(pos));
          btn.setAttribute("data-value", value);
          if (selectedOptions[pos] === value) btn.classList.add("is-selected");

          btn.addEventListener("click", function () {
            selectedOptions[pos] = value;
            onOptionsChanged();
          });

          buttonRow.appendChild(btn);
        });

        group.appendChild(buttonRow);
      }

      modalRefs.options.appendChild(group);
    });
  }

  // Re-render selection state + price/image/availability after a change.
  function onOptionsChanged() {
    renderOptionControls(); // refresh "is-selected" states
    updateVariantDependentUI();
  }

  function updateVariantDependentUI() {
    var variant = findMatchingVariant();

    if (variant) {
      modalRefs.price.textContent = variant.price;
      if (variant.image) modalRefs.image.src = variant.image;
      modalRefs.addToCart.disabled = !variant.available;
      modalRefs.addToCart.querySelector(
        ".gift-animated-button__label",
      ).textContent = variant.available
        ? (window.giftGuideStrings && window.giftGuideStrings.addToCart) ||
          "Add to cart"
        : "Sold out";
    } else {
      modalRefs.price.textContent = currentProduct.price;
      modalRefs.addToCart.disabled = true;
      modalRefs.addToCart.querySelector(
        ".gift-animated-button__label",
      ).textContent = "Select options";
    }
  }

  function openModal(blockId, triggerEl) {
    if (!modal && !cacheModalRefs()) return;

    var product = getProductJSON(blockId);
    if (!product) return;

    currentProduct = product;
    lastFocusedTrigger = triggerEl || null;

    // Default every option to its first value so a variant is preselected.
    selectedOptions = product.options.map(function (option) {
      return option.values[0];
    });

    modalRefs.image.src = product.image;
    modalRefs.image.alt = product.title;
    modalRefs.title.textContent = product.title;
    modalRefs.description.textContent = product.description;
    modalRefs.message.textContent = "";

    renderOptionControls();
    updateVariantDependentUI();

    modal.hidden = false;
    document.body.classList.add("gift-modal-open");
    modalRefs.dialog.focus();

    document.addEventListener("keydown", onModalKeyDown);
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("gift-modal-open");
    document.removeEventListener("keydown", onModalKeyDown);
    if (lastFocusedTrigger) lastFocusedTrigger.focus();
  }

  function onModalKeyDown(event) {
    if (event.key === "Escape") closeModal();
  }

  /* ---------------------------------------------------------------------
   * 3 & 4. Add to cart + Black/Medium bundle rule
   * ------------------------------------------------------------------- */

  // True if the variant's option values include both "black" and "medium",
  // regardless of which option position they occupy (color/size order can
  // vary between products).
  function variantMatchesBundleTrigger(variant) {
    var values = [variant.option1, variant.option2, variant.option3]
      .filter(Boolean)
      .map(function (v) {
        return v.toLowerCase();
      });

    var hasBlack = values.some(function (v) {
      return v.indexOf("black") !== -1;
    });
    var hasMedium = values.some(function (v) {
      return v === "medium" || v === "m";
    });

    return hasBlack && hasMedium;
  }

  function getBundleContext() {
    var gridSection = document.querySelector(
      '[data-section-type="product-grid"]',
    );
    if (!gridSection) return null;

    var bundleVariantId = gridSection.getAttribute("data-bundle-variant-id");
    var bundleProductId = gridSection.getAttribute("data-bundle-product-id");
    if (!bundleVariantId) return null;

    return { variantId: bundleVariantId, productId: bundleProductId };
  }

  function addToCart(variant) {
    var items = [{ id: variant.id, quantity: 1 }];

    var bundle = getBundleContext();
    if (
      bundle &&
      variantMatchesBundleTrigger(variant) &&
      String(currentProduct.id) !== String(bundle.productId)
    ) {
      items.push({ id: Number(bundle.variantId), quantity: 1 });
    }

    modalRefs.addToCart.disabled = true;
    modalRefs.message.textContent = "Adding to cart\u2026";

    fetch("/cart/add.js", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ items: items }),
    })
      .then(function (response) {
        if (!response.ok)
          return response.json().then(function (err) {
            throw err;
          });
        return response.json();
      })
      .then(function () {
        modalRefs.message.textContent =
          items.length > 1
            ? "Added to cart, plus a free bonus item!"
            : "Added to cart!";

        // Let the rest of the theme know the cart changed so any existing
        // cart drawer / bubble can refresh itself.
        document.dispatchEvent(new CustomEvent("cart:refresh"));
      })
      .catch(function (err) {
        console.error("Gift Guide: add to cart failed", err);
        modalRefs.message.textContent =
          (err && err.description) ||
          "Something went wrong adding this to your cart.";
      })
      .finally(function () {
        var variantNow = findMatchingVariant();
        modalRefs.addToCart.disabled = !(variantNow && variantNow.available);
      });
  }

  /* ---------------------------------------------------------------------
   * Event delegation / init
   * ------------------------------------------------------------------- */
  function initGrid() {
    document.addEventListener("click", function (event) {
      var trigger = event.target.closest("[data-gift-quick-view-trigger]");
      if (trigger) {
        openModal(trigger.getAttribute("data-product-ref"), trigger);
        return;
      }

      if (event.target.closest("[data-gift-modal-close]")) {
        closeModal();
        return;
      }

      if (event.target.closest(".gift-modal__add-to-cart")) {
        var variant = findMatchingVariant();
        if (variant && variant.available) addToCart(variant);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initMobileMenu();
    initGrid();
  });
})();
