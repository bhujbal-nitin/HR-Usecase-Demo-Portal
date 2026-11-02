"""Amounts in words, the Indian way (thousand, lakh, crore)."""

_ONES = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen",
]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _below_hundred(n: int) -> str:
    return _ONES[n] if n < 20 else f"{_TENS[n // 10]} {_ONES[n % 10]}".strip()


def _below_thousand(n: int) -> str:
    hundreds, rest = divmod(n, 100)
    return " ".join(part for part in (f"{_ONES[hundreds]} Hundred" if hundreds else "", _below_hundred(rest)) if part)


def rupees_in_words(amount: int) -> str:
    """3067600 -> "Thirty Lakh Sixty Seven Thousand Six Hundred Rupees"."""
    n = abs(int(amount))
    if n == 0:
        return "Zero Rupees"
    crore, n = divmod(n, 10_000_000)
    lakh, n = divmod(n, 100_000)
    thousand, n = divmod(n, 1_000)
    parts = [
        f"{_below_hundred(crore) if crore < 100 else _below_thousand(crore)} Crore" if crore else "",
        f"{_below_hundred(lakh)} Lakh" if lakh else "",
        f"{_below_hundred(thousand)} Thousand" if thousand else "",
        _below_thousand(n) if n else "",
    ]
    return f"{' '.join(part for part in parts if part)} Rupees"
