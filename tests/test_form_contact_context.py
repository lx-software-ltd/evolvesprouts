"""Unit tests for training-form contact placeholder formatting."""

from __future__ import annotations

from app.services.form_contact_context import (
    FALLBACK_CHILDREN,
    FALLBACK_CONTACT_NAME,
    FALLBACK_FAMILY_NAME,
    FALLBACK_HELPERS,
    build_placeholders_from_parts,
    fallback_form_contact_placeholders,
    join_english_list,
)


def test_join_english_list_formats_one_two_and_many() -> None:
    assert join_english_list([]) == ""
    assert join_english_list(["Ada"]) == "Ada"
    assert join_english_list(["Ada", "Ben"]) == "Ada and Ben"
    assert join_english_list(["Ada", "Ben", "Cara"]) == "Ada, Ben and Cara"


def test_fallback_placeholders_use_english_copy() -> None:
    values = fallback_form_contact_placeholders()
    assert values["contactName"] == FALLBACK_CONTACT_NAME
    assert values["familyName"] == FALLBACK_FAMILY_NAME
    assert values["children.firstName"] == FALLBACK_CHILDREN
    assert values["helpers.firstName"] == FALLBACK_HELPERS


def test_placeholders_fill_contact_and_household_names() -> None:
    values = build_placeholders_from_parts(
        first_name="Jane",
        last_name="Doe",
        family_name="The Does",
        children=[("Mia", "Doe"), ("Leo", "Doe")],
        helpers=[("Ana", None)],
    )
    assert values["contactName"] == "Jane Doe"
    assert values["contactFirstName"] == "Jane"
    assert values["contactLastName"] == "Doe"
    assert values["familyName"] == "The Does"
    assert values["children.firstName"] == "Mia and Leo"
    assert values["children.lastName"] == "Doe and Doe"
    assert values["children.contactName"] == "Mia Doe and Leo Doe"
    assert values["helpers.firstName"] == "Ana"
    assert values["helpers.contactName"] == "Ana"


def test_placeholders_use_fallbacks_when_household_empty() -> None:
    values = build_placeholders_from_parts(
        first_name="  ",
        last_name=None,
        family_name=None,
        children=[],
        helpers=[],
    )
    assert values["contactName"] == FALLBACK_CONTACT_NAME
    assert values["contactFirstName"] == FALLBACK_CONTACT_NAME
    assert values["familyName"] == FALLBACK_FAMILY_NAME
    assert values["children.firstName"] == FALLBACK_CHILDREN
    assert values["helpers.firstName"] == FALLBACK_HELPERS
