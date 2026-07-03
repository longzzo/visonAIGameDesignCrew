using UnityEngine;

public class ThrowController : MonoBehaviour
{
    public float maxThrowForce = 15f;
    public float minThrowForce = 5f;
    public float animationDelay = 0.05f; // 출발 직후만 적용
    public float reuseCooldown = 3f;

    public event System.Action<Vector2, float> OnThrow;
    public event System.Action OnThrowCooldown;

    private float lastThrowTime;

    private void Update()
    {
        // TODO: 터치/마우스 입력 감지 → 방향/힘 계산 → Throw 실행
    }

    public void Throw(Vector2 direction, float force)
    {
        if (Time.time - lastThrowTime < reuseCooldown) return;

        lastThrowTime = Time.time;
        OnThrow?.Invoke(direction, force);

        // TODO: 검 오브젝트 생성 + 애니메이션 지연 (animationDelay) 적용
    }

    public void StartCooldown()
    {
        OnThrowCooldown?.Invoke();
    }
}
