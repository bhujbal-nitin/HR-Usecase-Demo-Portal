from app.utils.formatting import format_inr, generate_temporary_password, split_name


def test_format_inr_uses_indian_grouping():
    assert format_inr(3_200_000) == "₹32,00,000"
    assert format_inr(999) == "₹999"
    assert format_inr(100_000) == "₹1,00,000"
    assert format_inr(34_500_000, "INR ") == "INR 3,45,00,000"


def test_split_name():
    assert split_name("Aarav Sharma") == ("Aarav", "", "Sharma")
    assert split_name("Mary Ann Lee") == ("Mary", "Ann", "Lee")
    assert split_name("Cher") == ("Cher", "", "")


def test_temporary_password_meets_complexity():
    password = generate_temporary_password()
    assert len(password) >= 12
    assert any(c.isupper() for c in password)
    assert any(c.islower() for c in password)
    assert any(c.isdigit() for c in password)
    assert any(not c.isalnum() for c in password)
