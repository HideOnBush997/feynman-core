using Feynman.Api;
using Feynman.Api.Domain;
using Xunit;

namespace Feynman.Api.Tests;

public class DomainTests
{
    [Theory]
    [InlineData(-1, 2)]
    [InlineData(0, 0)]
    [InlineData(2, 1)]
    public void InvalidIntervalsAreRejected(long start, long end) => Assert.Throws<AppException>(() => SegmentRules.Validate([new(start, end)], null));
    [Fact]
    public void TouchingIntervalsAreAllowedAndTotalsCanExceedInt32() => SegmentRules.Validate([new(0, 3000000000), new(3000000000, 6000000000)], null, true);
    [Fact]
    public void OverlapAndDuplicatesHaveStableCodes()
    {
        Assert.Equal("segment_overlap", Assert.Throws<AppException>(() => SegmentRules.Validate([new(10, 30), new(0, 20)], null)).Code);
        Assert.Equal("segment_duplicate", Assert.Throws<AppException>(() => SegmentRules.Validate([new(0, 20), new(0, 20)], null)).Code);
    }
    [Theory]
    [InlineData(null, true)]
    [InlineData(20L, true)]
    [InlineData(19L, false)]
    [InlineData(0L, false)]
    public void VideoBoundaryIsEnforcedOnlyWhenKnown(long? duration, bool valid)
    {
        if (valid) SegmentRules.Validate([new(0, 20)], duration);
        else Assert.Throws<AppException>(() => SegmentRules.Validate([new(0, 20)], duration));
    }
    [Fact]
    public void SubmissionRequiresAtLeastOneSegment() => Assert.Equal("submission_requires_segment", Assert.Throws<AppException>(() => SegmentRules.Validate([], null, true)).Code);
    [Theory]
    [InlineData("2026-10-24", "2026-10-23T16:00:00Z")]
    [InlineData("2026-03-08", "2026-03-07T16:00:00Z")]
    [InlineData("2026-11-01", "2026-10-31T16:00:00Z")]
    public void ShanghaiBoundariesNeverUseHostTimezoneOrForeignDst(string date, string expected)
    {
        var (from, until) = ShanghaiTime.Range(DateOnly.Parse(date), DateOnly.Parse(date));
        Assert.Equal(DateTime.Parse(expected).ToUniversalTime(), from);
        Assert.Equal(TimeSpan.FromDays(1), until - from);
        Assert.Equal(DateOnly.Parse(date), ShanghaiTime.Date(from));
        Assert.Equal(DateOnly.Parse(date).AddDays(-1), ShanghaiTime.Date(from.AddTicks(-1)));
    }
    [Fact]
    public void LocalDueAtMustBeOffsetFreeAndDateRangesMustBeOrdered()
    {
        Assert.Equal(new DateTime(2026, 10, 23, 16, 0, 0, DateTimeKind.Utc), ShanghaiTime.ParseLocal("2026-10-24T00:00:00"));
        Assert.Throws<AppException>(() => ShanghaiTime.ParseLocal("2026-10-24T00:00:00Z"));
        Assert.Throws<AppException>(() => ShanghaiTime.Range(new(2026, 10, 25), new(2026, 10, 24)));
    }
}
