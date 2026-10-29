"""Demo helper: generates a unique, realistic Indian candidate profile for the wizard's Auto-Fill."""

import logging
import random
import threading
import time
from datetime import date, timedelta

from app.integrations.orangehrm import OrangeHRMClient
from app.repositories.employee_repository import EmployeeRepository
from app.schemas.employee import AutofillProfile

logger = logging.getLogger(__name__)

FIRST_NAMES = [
    "Aarav", "Aditya", "Advait", "Akash", "Alok", "Amit", "Ananya", "Aniket", "Anjali", "Arjun",
    "Aryan", "Ashwin", "Ayush", "Bhavna", "Chetan", "Deepak", "Devendra", "Divya", "Gaurav", "Harish",
    "Ishaan", "Karan", "Karthik", "Kavita", "Kunal", "Manish", "Mayank", "Meera", "Mohit", "Naveen",
    "Neha", "Nikhil", "Nilesh", "Omkar", "Pankaj", "Pooja", "Pranav", "Prateek", "Priya", "Priyanka",
    "Rahul", "Rajesh", "Rakesh", "Ramesh", "Rhea", "Rishabh", "Ritu", "Riya", "Rohan", "Rohit",
    "Sachin", "Sameer", "Sanjay", "Saurabh", "Shalini", "Shivam", "Shreya", "Siddharth", "Simran", "Sneha",
    "Soham", "Sumit", "Sunil", "Suresh", "Swati", "Tanvi", "Tarun", "Tushar", "Varun", "Vikram",
    "Vinay", "Vishal", "Vivek", "Yash",
]
LAST_NAMES = [
    "Agarwal", "Bansal", "Bhandari", "Bhatia", "Bhosale", "Chavan", "Chopra", "Deshmukh", "Dubey", "Gaikwad",
    "Goel", "Gokhale", "Gupta", "Gupte", "Hegde", "Iyer", "Jadhav", "Jain", "Jindal", "Joshi",
    "Kadam", "Kamath", "Kapoor", "Khanna", "Kulkarni", "Malhotra", "Mane", "Mehta", "Menon", "Mishra",
    "Mittal", "More", "Mukherjee", "Nair", "Pandey", "Patel", "Patil", "Pawar", "Pillai", "Prabhu",
    "Rao", "Reddy", "Salunkhe", "Sawant", "Saxena", "Sethi", "Sharma", "Shetty", "Shinde", "Singhal",
    "Srivastava", "Tambe", "Tendulkar", "Tiwari", "Varma", "Verma",
]
# (department, job title, manager, hardware, annual CTC in INR)
ROLES = [
    ("Engineering", "Staff AI Systems Engineer", "Amit Deshmukh (VP of Engineering)", "Apple MacBook Pro M3 Max", 3_450_000),
    ("Engineering", "Lead Cloud Solutions Architect", "Suresh Nair (Director of Cloud Infrastructure)", "Apple MacBook Pro M3 Max", 3_600_000),
    ("Engineering", "Senior Machine Learning Specialist", "Amit Deshmukh (VP of Engineering)", "Apple MacBook Pro M3 Max", 2_900_000),
    ("Engineering", "Full Stack DevOps Engineer", "David Miller (Director of Engineering)", "Dell XPS 15 9530 (i9 64GB RTX)", 2_450_000),
    ("Engineering", "Senior Backend Platform Engineer", "Amit Deshmukh (VP of Engineering)", "Apple MacBook Pro M3 Max", 2_700_000),
    ("Data & AI", "Principal Data Platform Architect", "Priya Iyer (Head of Data & AI)", "Apple MacBook Pro M3 Max", 3_800_000),
    ("Data & AI", "Lead Data Science Engineer", "Priya Iyer (Head of Data & AI)", "Apple MacBook Pro M3 Max", 2_850_000),
    ("Quality Assurance", "Lead Automation QA Engineer", "Rohan Mehta (Director of QA)", "Lenovo ThinkPad P1 Gen 6", 2_100_000),
    ("Cloud Infrastructure", "Senior Site Reliability Engineer", "Suresh Nair (Director of Cloud Infrastructure)", "Apple MacBook Pro M3 Max", 2_600_000),
    ("Product Management", "Senior Technical Product Manager", "Pooja Deshmukh (VP of Product)", "Apple MacBook Pro M3 Max", 3_100_000),
    ("Cybersecurity", "Enterprise Security Architect", "Vikram Malhotra (CISO)", "Lenovo ThinkPad P1 Gen 6", 3_300_000),
]
ADDRESSES = [
    "Flat 402, Marvel Palms, Baner, Pune, Maharashtra 411045",
    "Tower 8, Apt 1104, Blue Ridge Town, Hinjawadi Phase 2, Pune, Maharashtra 411057",
    "B-303, Rohan Tarang, Wakad, Pune, Maharashtra 411057",
    "1200 Silicon Residency, Sector 5, HSR Layout, Bengaluru, Karnataka 560102",
    "Apt 601, Prestige Oasis, Whitefield, Bengaluru, Karnataka 560066",
    "Flat 15B, Lodha Bellissimo, Apollo Mills, Lower Parel, Mumbai, Maharashtra 400011",
    "Plot 45, Jubilee Hills, Road No. 36, Hyderabad, Telangana 500033",
    "Villa 12, Palm Meadows, Kharadi, Pune, Maharashtra 411014",
    "B-12, Panchsheel Park, New Delhi, Delhi 110017",
    "Row House 7, Amanora Sweet Water Villas, Hadapsar, Pune, Maharashtra 411028",
]
WORK_LOCATIONS = ["Hybrid", "On-Site (Pune Tech Park)", "Remote"]
RELATIONS = ["Father", "Mother", "Spouse", "Brother", "Sister"]
_DIRECTORY_REFRESH_SECONDS = 300


class AutofillService:
    def __init__(self, repository: EmployeeRepository, orangehrm: OrangeHRMClient):
        self._repo = repository
        self._ohrm = orangehrm
        self._directory_names: set[str] = set()
        self._directory_refreshed_at = 0.0
        self._lock = threading.Lock()

    def generate(self) -> AutofillProfile:
        taken = {e.full_name.lower() for e in self._repo.list_all()} | self._cached_directory_names()

        first, last = random.choice(FIRST_NAMES), random.choice(LAST_NAMES)
        for _ in range(300):
            if f"{first} {last}".lower() not in taken:
                break
            first, last = random.choice(FIRST_NAMES), random.choice(LAST_NAMES)
        else:  # exhausted the name space: disambiguate instead of colliding
            last = f"{last}{random.randint(10, 99)}"

        department, job_title, manager, hardware, ctc = random.choice(ROLES)
        today = date.today()
        mobile = lambda: f"+91 {random.choice([98, 97, 96, 95, 99, 93])}{random.randint(10, 99)} {random.randint(10000, 99999)}"  # noqa: E731

        return AutofillProfile(
            full_name=f"{first} {last}",
            email=f"{first.lower()}.{last.lower()}@example.com",
            phone=mobile(),
            dob=date(random.randint(1991, 1999), random.randint(1, 12), random.randint(1, 28)),
            aadhaar=f"{random.randint(2000, 8999)}{random.randint(1000, 9999)}{random.randint(1000, 9999)}",
            uan=f"1012{random.randint(1000, 9999)}{random.randint(1000, 9999)}",
            emergency_name=f"{random.choice(FIRST_NAMES)} {last} ({random.choice(RELATIONS)})",
            emergency_phone=mobile(),
            address=random.choice(ADDRESSES),
            department=department,
            job_title=job_title,
            manager=manager,
            start_date=today + timedelta(days=14),
            annual_ctc=ctc,
            hardware=hardware,
            work_location=random.choice(WORK_LOCATIONS),
        )

    # ------------------------------------------------------------- internals
    def _cached_directory_names(self) -> set[str]:
        """Names already in OrangeHRM. Refreshed in the background so the request never blocks on it."""
        with self._lock:
            if time.time() - self._directory_refreshed_at > _DIRECTORY_REFRESH_SECONDS:
                self._directory_refreshed_at = time.time()
                if self._ohrm.is_configured():
                    threading.Thread(target=self._refresh_directory, daemon=True).start()
            return set(self._directory_names)

    def _refresh_directory(self) -> None:
        try:
            names = self._ohrm.list_employee_names()
        except Exception as exc:  # noqa: BLE001 - purely best-effort
            logger.info("OrangeHRM directory refresh skipped: %s", exc)
            return
        with self._lock:
            self._directory_names = names
