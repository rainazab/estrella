from app.export_data_json import build_objectives


def _rec(
    *,
    gain: str = "+1.0",
    deadline: str = "on time",
    late: float | None = 0.0,
    time_score: float = 100.0,
    orders_moved: int = 0,
    inserted_end: float = 24.0,
) -> dict:
    rec = {
        "oeeDelta": gain,
        "deadline": deadline,
        "timeScore": time_score,
        "ordersMoved": orders_moved,
        "insertedEndHours": inserted_end,
        "recovery": {"hours": 1},
    }
    if late is not None:
        rec["deadlineHoursLate"] = late
    return rec


class TestBuildObjectives:
    def test_time_objective_prefers_on_time_over_lower_blended_score(self):
        objectives = build_objectives({
            "14": _rec(deadline="on time", late=0, time_score=900, orders_moved=8),
            "17": _rec(deadline="+1h late", late=1, time_score=10, orders_moved=0),
            "19": _rec(deadline="+3h late", late=3, time_score=1, orders_moved=0),
        })

        assert objectives["time"]["order"][0] == "14"
        assert objectives["time"]["notes"]["14"].startswith("Deadline respected")
        assert objectives["time"]["notes"]["17"].startswith("Deadline +1h late")

    def test_time_objective_prefers_earliest_completion_among_on_time_options(self):
        objectives = build_objectives({
            "14": _rec(deadline="on time", late=0, time_score=900, orders_moved=11, inserted_end=75),
            "17": _rec(deadline="on time", late=0, time_score=10, orders_moved=0, inserted_end=120),
            "19": _rec(deadline="on time", late=0, time_score=100, orders_moved=4, inserted_end=113),
        })

        assert objectives["time"]["order"] == ["14", "19", "17"]

    def test_time_objective_uses_least_late_when_no_on_time_option_exists(self):
        objectives = build_objectives({
            "14": _rec(deadline="+4h late", late=4, time_score=1),
            "17": _rec(deadline="+1h late", late=1, time_score=900),
            "19": _rec(deadline="+2h late", late=2, time_score=10),
        })

        assert objectives["time"]["order"] == ["17", "19", "14"]
