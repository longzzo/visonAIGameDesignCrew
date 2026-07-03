using UnityEngine;

public class PhysicsSkinManager : MonoBehaviour
{
    public SkinData[] skinTypes;
    public event System.Action<string> OnSkinApplied;
    public event System.Action<string> OnSkinCooldown;

    private void Start() => LoadSkinData();

    private void LoadSkinData()
    {
        // TODO: Resources.Load<SkinData>("Data/SkinData") 및 배열 할당
    }

    public void ApplySkin(string skinName, Rigidbody2D target)
    {
        // TODO: SkinData 찾기 → 속성 적용 → OnSkinApplied 발행
    }

    public bool CanApplySkin(string skinName)
    {
        // TODO: 쿨다운 체크 및 충돌 제한 확인
        return true;
    }

    public void TriggerCooldown(string skinName)
    {
        // TODO: 쿨다운 시작 → OnSkinCooldown 발행
    }
}
