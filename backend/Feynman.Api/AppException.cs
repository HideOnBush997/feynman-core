namespace Feynman.Api;

public sealed class AppException(int status, string code, string detail, IDictionary<string, string[]>? errors = null) : Exception(detail)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public IDictionary<string, string[]>? Errors { get; } = errors;
}
